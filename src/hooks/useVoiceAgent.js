import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../lib/api.js';
import { Recognizer, Speaker, loadVoices, pickIndianVoice, speechSupport } from '../lib/speech.js';

// How long to wait after the recogniser finalises a phrase before treating
// the customer's turn as finished (they may just be pausing mid-sentence).
const END_OF_TURN_MS = 500;
// Nudge the customer if nothing is said for this long after Aria finishes.
const SILENCE_NUDGE_MS = 12000;
const MAX_SILENCE_NUDGES = 2;
// After Aria stops speaking, the mic can still pick up the tail of her voice.
const ECHO_TAIL_MS = 1500;

const words = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

// Without headphones, the recogniser hears Aria through the speakers. Treat
// recognised speech as echo if most of its words are in what she is saying.
function isEcho(heard, agentText) {
  const heardWords = words(heard);
  if (!heardWords.length) return true;
  const agentWords = new Set(words(agentText));
  const overlap = heardWords.filter((w) => agentWords.has(w)).length;
  return overlap / heardWords.length >= 0.6;
}

const INTERRUPT_WORDS = /^(stop|wait|sorry|hello|excuse me|ruko|ek minute|hold on|no)$/i;

let entryId = 0;
const nextId = () => ++entryId;

export function useVoiceAgent() {
  const [status, setStatusState] = useState('idle'); // idle | connecting | listening | thinking | speaking | ending | ended
  const [transcript, setTranscript] = useState([]);
  const [caption, setCaption] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [voices, setVoices] = useState([]);
  const [voiceName, setVoiceName] = useState('');
  const [bargeIn, setBargeInState] = useState(true);
  const [lastLatencyMs, setLastLatencyMs] = useState(null);

  const statusRef = useRef('idle');
  const callIdRef = useRef(null);
  const speakerRef = useRef(null);
  const recognizerRef = useRef(null);
  const inflightRef = useRef(null); // AbortController of the running turn
  const pendingRef = useRef(''); // customer words not yet sent
  const confidenceRef = useRef(1);
  const lastSentRef = useRef(''); // text of the in-flight turn (merged if they keep talking)
  const interruptedRef = useRef(null); // what they heard before barging in
  const agentTextRef = useRef(''); // Aria's current reply, for echo detection
  const speechEndedAtRef = useRef(0);
  const endOfTurnTimer = useRef(null);
  const silenceTimer = useRef(null);
  const silenceNudges = useRef(0);
  const turnStartedAt = useRef(0);
  const hangUpAfterSpeech = useRef(false);
  const agentEntryRef = useRef(null);
  const bargeInRef = useRef(true);

  const setBargeIn = useCallback((value) => {
    bargeInRef.current = value;
    setBargeInState(value);
  }, []);

  const setStatus = useCallback((s) => {
    statusRef.current = s;
    setStatusState(s);
  }, []);

  const addEntry = useCallback((entry) => {
    const id = nextId();
    setTranscript((t) => [...t, { id, at: new Date().toISOString(), ...entry }]);
    return id;
  }, []);

  const updateEntry = useCallback((id, patch) => {
    setTranscript((t) => t.map((e) => (e.id === id ? { ...e, ...(typeof patch === 'function' ? patch(e) : patch) } : e)));
  }, []);

  const inCall = () => ['listening', 'thinking', 'speaking'].includes(statusRef.current);

  // ------------------------------------------------------------ timers

  const clearTimers = useCallback(() => {
    clearTimeout(endOfTurnTimer.current);
    clearTimeout(silenceTimer.current);
  }, []);

  // ------------------------------------------------------------ call end

  const finishCall = useCallback(async () => {
    const callId = callIdRef.current;
    if (!callId || statusRef.current === 'ending' || statusRef.current === 'ended') return;
    clearTimers();
    recognizerRef.current?.stop();
    speakerRef.current?.cancel();
    inflightRef.current?.abort();
    setCaption('');
    setStatus('ending');
    try {
      const data = await api.endCall(callId);
      setResult(data);
    } catch (err) {
      setError(`Could not fetch the call summary: ${err.message}`);
    } finally {
      callIdRef.current = null;
      setStatus('ended');
    }
  }, [clearTimers, setStatus]);

  // ------------------------------------------------------------ sending a turn

  const sendTurn = useCallback(
    async (payload) => {
      const callId = callIdRef.current;
      if (!callId) return;
      clearTimers();

      const controller = new AbortController();
      inflightRef.current = controller;
      const speaker = speakerRef.current;
      speaker.begin();
      agentTextRef.current = '';
      agentEntryRef.current = null;
      hangUpAfterSpeech.current = false;
      turnStartedAt.current = performance.now();
      setStatus('thinking');

      if (payload.event === 'silence') addEntry({ role: 'event', text: 'Customer silent — Aria checks in' });

      const ensureAgentEntry = () => {
        if (!agentEntryRef.current) agentEntryRef.current = addEntry({ role: 'agent', text: '' });
        return agentEntryRef.current;
      };

      try {
        await api.streamTurn(callId, payload, {
          signal: controller.signal,
          onEvent: (event, data) => {
            if (controller.signal.aborted) return;
            if (event === 'text') {
              agentTextRef.current += data.delta;
              speaker.push(data.delta);
              updateEntry(ensureAgentEntry(), (e) => ({ text: e.text + data.delta }));
            } else if (event === 'tool') {
              addEntry({ role: 'tool', tool: data });
            } else if (event === 'done') {
              hangUpAfterSpeech.current = Boolean(data.endCall);
              speaker.end();
            } else if (event === 'error') {
              setError(data.message);
              if (data.spoken) {
                agentTextRef.current += data.spoken;
                speaker.push(`${data.spoken} `);
                addEntry({ role: 'agent', text: data.spoken });
              }
              speaker.end();
            }
          },
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err.message || 'Connection problem.');
        speaker.say("Sorry, I lost the connection for a moment. Could you say that again?");
      } finally {
        if (inflightRef.current === controller) inflightRef.current = null;
        // Stream closed without a done/error event: still let the reply finish.
        if (!controller.signal.aborted && !speaker.streamDone) speaker.end();
      }
    },
    [addEntry, clearTimers, setStatus, updateEntry],
  );

  const armSilenceTimer = useCallback(() => {
    clearTimeout(silenceTimer.current);
    if (silenceNudges.current >= MAX_SILENCE_NUDGES) return;
    silenceTimer.current = setTimeout(() => {
      if (statusRef.current !== 'listening' || pendingRef.current) return;
      silenceNudges.current += 1;
      sendTurn({ event: 'silence' });
    }, SILENCE_NUDGE_MS);
  }, [sendTurn]);

  const commitCustomerTurn = useCallback(() => {
    const text = pendingRef.current.trim();
    pendingRef.current = '';
    setCaption('');
    if (!text) return;
    lastSentRef.current = text;
    silenceNudges.current = 0;
    addEntry({ role: 'customer', text });
    const payload = { text, confidence: confidenceRef.current };
    if (interruptedRef.current !== null) payload.interruptedAfter = interruptedRef.current;
    interruptedRef.current = null;
    confidenceRef.current = 1;
    sendTurn(payload);
  }, [addEntry, sendTurn]);

  // Customer started talking over Aria.
  const bargeInNow = useCallback(() => {
    const speaker = speakerRef.current;
    interruptedRef.current = speaker.heardText();
    speaker.cancel();
    inflightRef.current?.abort();
    inflightRef.current = null;
    if (agentEntryRef.current) updateEntry(agentEntryRef.current, { interrupted: true });
    agentEntryRef.current = null;
    setStatus('listening');
  }, [setStatus, updateEntry]);

  // Customer kept talking after we already sent their turn and nothing has
  // been spoken yet: cancel that request and resend everything together.
  const reopenCustomerTurn = useCallback(() => {
    inflightRef.current?.abort();
    inflightRef.current = null;
    speakerRef.current.cancel();
    const previous = lastSentRef.current;
    setTranscript((t) => {
      const i = t.findLastIndex((e) => e.role === 'customer');
      return i === -1 ? t : t.filter((e, idx) => idx < i || (e.role !== 'customer' && e.role !== 'agent' && e.role !== 'tool'));
    });
    agentEntryRef.current = null;
    pendingRef.current = previous ? `${previous} ` : '';
    setStatus('listening');
  }, [setStatus]);

  // ------------------------------------------------------------ recogniser events

  const handleSpeech = useCallback(
    (text, { final, confidence }) => {
      if (!inCall()) return;
      const status = statusRef.current;
      const recentlySpoke = Date.now() - speechEndedAtRef.current < ECHO_TAIL_MS;

      if (status === 'speaking' || (status === 'listening' && recentlySpoke)) {
        if (isEcho(text, agentTextRef.current)) return;
      }

      if (status === 'speaking') {
        if (!bargeInRef.current) return;
        const wordCount = words(text).length;
        if (wordCount < 2 && !INTERRUPT_WORDS.test(text.trim())) return;
        bargeInNow();
      } else if (status === 'thinking') {
        if (!final || !bargeInRef.current) return;
        // A request is in flight: merge. Otherwise it's the greeting about to play.
        if (inflightRef.current) reopenCustomerTurn();
        else bargeInNow();
      }

      clearTimeout(silenceTimer.current);
      clearTimeout(endOfTurnTimer.current);
      if (final) {
        pendingRef.current = `${pendingRef.current}${text} `;
        if (confidence > 0) confidenceRef.current = Math.min(confidenceRef.current, confidence);
        setCaption(pendingRef.current.trim());
        endOfTurnTimer.current = setTimeout(commitCustomerTurn, END_OF_TURN_MS);
      } else {
        setCaption(`${pendingRef.current}${text}`.trim());
      }
    },
    [bargeInNow, commitCustomerTurn, reopenCustomerTurn],
  );

  // ------------------------------------------------------------ setup

  useEffect(() => {
    let cancelled = false;
    loadVoices().then((list) => {
      if (cancelled) return;
      setVoices(list);
      const preferred = pickIndianVoice(list);
      if (preferred) setVoiceName(preferred.name);
    });
    return () => {
      cancelled = true;
      recognizerRef.current?.stop();
      speakerRef.current?.cancel();
      inflightRef.current?.abort();
      clearTimers();
    };
  }, [clearTimers]);

  useEffect(() => {
    if (speakerRef.current) speakerRef.current.voice = voices.find((v) => v.name === voiceName) ?? null;
  }, [voiceName, voices]);

  // ------------------------------------------------------------ public actions

  const start = useCallback(async () => {
    setError(null);
    setResult(null);
    setTranscript([]);
    setCaption('');
    setLastLatencyMs(null);
    silenceNudges.current = 0;
    pendingRef.current = '';
    lastSentRef.current = '';
    interruptedRef.current = null;
    hangUpAfterSpeech.current = false;
    setStatus('connecting');

    speakerRef.current?.cancel();
    const speaker = new Speaker({
      onStart: () => {
        if (!inCall()) return;
        setStatus('speaking');
        setLastLatencyMs(Math.round(performance.now() - turnStartedAt.current));
      },
      onIdle: () => {
        if (!inCall()) return;
        speechEndedAtRef.current = Date.now();
        if (hangUpAfterSpeech.current) {
          finishCall();
          return;
        }
        setStatus('listening');
        armSilenceTimer();
      },
    });
    speaker.voice = voices.find((v) => v.name === voiceName) ?? null;
    speakerRef.current = speaker;

    let call;
    try {
      call = await api.startCall();
    } catch (err) {
      setError(`Could not start the call: ${err.message}`);
      setStatus('idle');
      return;
    }
    callIdRef.current = call.callId;

    if (speechSupport.stt) {
      const recognizer = new Recognizer({
        lang: 'en-IN',
        onInterim: (text) => text && handleSpeech(text, { final: false }),
        onFinal: (text, confidence) => handleSpeech(text, { final: true, confidence }),
        onError: (code, fatal) => {
          if (!fatal) return;
          setError(
            code === 'not-allowed' || code === 'service-not-allowed'
              ? 'Microphone access was blocked. Allow the mic in your browser (address bar icon) or type your messages below.'
              : 'The microphone stopped working. You can keep going by typing below.',
          );
        },
      });
      recognizerRef.current = recognizer;
      recognizer.start();
    } else {
      setError('Voice input needs Chrome or Edge. You can still type your messages; Aria will reply by voice.');
    }

    // Greet immediately; no network round-trip needed.
    setStatus('thinking');
    agentTextRef.current = call.greeting;
    turnStartedAt.current = performance.now();
    addEntry({ role: 'agent', text: call.greeting });
    speaker.say(call.greeting);
  }, [addEntry, armSilenceTimer, finishCall, handleSpeech, setStatus, voiceName, voices]);

  const sendText = useCallback(
    (text) => {
      const clean = text.trim();
      if (!clean || !inCall()) return;
      clearTimeout(endOfTurnTimer.current);
      if (statusRef.current === 'speaking') bargeInNow();
      else if (statusRef.current === 'thinking' && inflightRef.current) reopenCustomerTurn();
      pendingRef.current = `${pendingRef.current}${clean}`;
      confidenceRef.current = 1;
      commitCustomerTurn();
    },
    [bargeInNow, commitCustomerTurn, reopenCustomerTurn],
  );

  const interrupt = useCallback(() => {
    if (statusRef.current === 'speaking') bargeInNow();
  }, [bargeInNow]);

  return {
    status,
    transcript,
    caption,
    result,
    error,
    dismissError: () => setError(null),
    voices,
    voiceName,
    setVoiceName,
    bargeIn,
    setBargeIn,
    lastLatencyMs,
    support: speechSupport,
    start,
    end: finishCall,
    sendText,
    interrupt,
  };
}
