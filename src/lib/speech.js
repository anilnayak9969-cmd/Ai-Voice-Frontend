// Browser speech: text-to-speech (speechSynthesis) and speech-to-text
// (SpeechRecognition). Both are free, need no keys, and run locally in Chrome/Edge.

const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
const SpeechRecognitionImpl =
  typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : undefined;

export const speechSupport = {
  tts: Boolean(synth),
  stt: Boolean(SpeechRecognitionImpl),
};

// ---------------------------------------------------------------- voices

// Indian English voices, best first: Edge's neural voices (Neerja), then
// Windows (Heera), macOS (Veena/Rishi), Android/ChromeOS.
const PREFERRED_VOICE_NAMES = [/neerja/i, /aarohi/i, /ananya/i, /heera/i, /veena/i, /isha/i, /kajal/i, /prabhat/i, /rishi/i, /ravi/i];

export function loadVoices() {
  if (!synth) return Promise.resolve([]);
  const voices = synth.getVoices();
  if (voices.length) return Promise.resolve(voices);
  return new Promise((resolve) => {
    const done = () => resolve(synth.getVoices());
    synth.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

export function pickIndianVoice(voices) {
  const enIN = voices.filter((v) => /^en[-_]IN/i.test(v.lang));
  for (const pattern of PREFERRED_VOICE_NAMES) {
    const match = enIN.find((v) => pattern.test(v.name));
    if (match) return match;
  }
  if (enIN.length) return enIN.find((v) => /natural|online/i.test(v.name)) ?? enIN[0];
  // Chrome ships no en-IN voice, but its Hindi voice reads English with an Indian accent.
  const googleHindi = voices.find((v) => /^hi[-_]IN/i.test(v.lang) && /google/i.test(v.name));
  if (googleHindi) return googleHindi;
  return voices.find((v) => /^en[-_]GB/i.test(v.lang)) ?? voices.find((v) => /^en/i.test(v.lang)) ?? null;
}

// ---------------------------------------------------------------- speaker

// Speaks a reply sentence by sentence as it streams in, so audio starts after
// the first sentence instead of after the whole reply. Also tracks how much
// the customer actually heard, which matters when they interrupt.
export class Speaker {
  constructor({ onStart, onIdle } = {}) {
    this.onStart = onStart;
    this.onIdle = onIdle;
    this.voice = null;
    this.rate = 1.05;
    this.generation = 0;
    this.reset();
  }

  reset() {
    this.queue = [];
    this.buffer = '';
    this.playing = null; // { text, charIndex }
    this.heard = '';
    this.streamDone = true;
    this.started = false;
  }

  get isActive() {
    return Boolean(this.playing) || this.queue.length > 0 || !this.streamDone;
  }

  // Everything fully spoken so far this turn, plus the partial sentence
  // (when the voice reports word boundaries).
  heardText() {
    const partial = this.playing ? this.playing.text.slice(0, this.playing.charIndex) : '';
    return `${this.heard}${partial}`.trim();
  }

  // Start a new reply. Cancels anything still playing.
  begin() {
    this.cancel();
    this.streamDone = false;
  }

  push(delta) {
    this.buffer += delta;
    for (;;) {
      // A sentence ends at . ! ? or । followed by whitespace. Very long
      // clauses are split at a comma so speech still starts quickly.
      const end = this.buffer.search(/[.!?।]+["')\]]*\s/);
      if (end !== -1) {
        const cut = this.buffer.slice(end).search(/\s/) + end;
        this.enqueue(this.buffer.slice(0, cut));
        this.buffer = this.buffer.slice(cut).replace(/^\s+/, '');
        continue;
      }
      if (this.buffer.length > 160) {
        const comma = this.buffer.lastIndexOf(', ');
        if (comma > 40) {
          this.enqueue(this.buffer.slice(0, comma + 1));
          this.buffer = this.buffer.slice(comma + 2);
          continue;
        }
      }
      break;
    }
  }

  end() {
    if (this.buffer.trim()) this.enqueue(this.buffer);
    this.buffer = '';
    this.streamDone = true;
    if (!this.playing && this.queue.length === 0) this.finish();
  }

  // Speak a complete piece of text as its own reply.
  say(text) {
    this.begin();
    this.push(`${text} `);
    this.end();
  }

  cancel() {
    this.generation += 1;
    this.reset();
    synth?.cancel();
  }

  enqueue(text) {
    const clean = text.replace(/[*_#`]/g, '').trim();
    if (!clean) return;
    this.queue.push(clean);
    if (!this.playing) this.playNext();
  }

  playNext() {
    const text = this.queue.shift();
    if (!text) {
      this.playing = null;
      if (this.streamDone) this.finish();
      return;
    }
    if (!synth) {
      // No TTS: behave as if spoken instantly so the call still flows.
      this.heard += `${text} `;
      this.playNext();
      return;
    }
    const generation = this.generation;
    const utterance = new SpeechSynthesisUtterance(text);
    if (this.voice) utterance.voice = this.voice;
    utterance.lang = this.voice?.lang || 'en-IN';
    utterance.rate = this.rate;
    this.playing = { text, charIndex: 0, utterance }; // keep a reference: Chrome GCs utterances and drops onend
    utterance.onstart = () => {
      if (generation !== this.generation) return;
      if (!this.started) {
        this.started = true;
        this.onStart?.();
      }
    };
    utterance.onboundary = (e) => {
      if (generation === this.generation && this.playing) this.playing.charIndex = e.charIndex;
    };
    let watchdog;
    const next = () => {
      clearTimeout(watchdog);
      if (generation !== this.generation || this.playing?.utterance !== utterance) return;
      this.heard += `${text} `;
      this.playing = null;
      this.playNext();
    };
    utterance.onend = next;
    utterance.onerror = next;
    // Chrome occasionally never fires onend; don't let the call hang on it.
    watchdog = setTimeout(() => {
      if (this.playing?.utterance === utterance) {
        synth.cancel();
        next();
      }
    }, 4000 + text.length * 110);
    synth.speak(utterance);
  }

  finish() {
    const generation = this.generation;
    // Defer so callers can finish their own state updates first.
    queueMicrotask(() => {
      if (generation === this.generation && !this.isActive) this.onIdle?.();
    });
  }
}

// ---------------------------------------------------------------- recognizer

// Continuous recognition that restarts itself (Chrome ends sessions after
// silence or ~60s) until stop() is called.
export class Recognizer {
  constructor({ lang = 'en-IN', onInterim, onFinal, onError } = {}) {
    this.lang = lang;
    this.onInterim = onInterim;
    this.onFinal = onFinal;
    this.onError = onError;
    this.active = false;
    this.restarts = [];
  }

  start() {
    if (!SpeechRecognitionImpl || this.active) return;
    this.active = true;
    this.spawn();
  }

  stop() {
    this.active = false;
    const rec = this.rec;
    this.rec = null;
    try {
      rec?.abort();
    } catch {
      // already stopped
    }
  }

  spawn() {
    const rec = new SpeechRecognitionImpl();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const { transcript, confidence } = result[0];
        if (result.isFinal) {
          if (transcript.trim()) this.onFinal?.(transcript.trim(), confidence);
        } else {
          interim += transcript;
        }
      }
      this.onInterim?.(interim.trim());
    };

    rec.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed' || event.error === 'audio-capture') {
        this.active = false;
        this.onError?.(event.error, true);
        return;
      }
      this.onError?.(event.error, false);
    };

    rec.onend = () => {
      if (!this.active || this.rec !== rec) return;
      // Guard against a tight restart loop (e.g. mic unplugged).
      const now = Date.now();
      this.restarts = this.restarts.filter((t) => now - t < 5000);
      this.restarts.push(now);
      if (this.restarts.length > 6) {
        this.active = false;
        this.onError?.('restart-loop', true);
        return;
      }
      setTimeout(() => this.active && this.rec === rec && this.spawn(), 150);
    };

    this.rec = rec;
    try {
      rec.start();
    } catch (err) {
      this.onError?.(err.message, false);
    }
  }
}
