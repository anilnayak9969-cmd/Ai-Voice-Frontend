import { useState } from 'react';

const STATES = [
  { key: 'listening', label: 'Listening' },
  { key: 'thinking', label: 'Thinking' },
  { key: 'speaking', label: 'Speaking' },
];

const STATUS_TEXT = {
  idle: 'Ready to call',
  connecting: 'Connecting…',
  listening: 'Listening — go ahead and speak',
  thinking: 'Thinking…',
  speaking: 'Aria is speaking',
  ending: 'Ending call & generating summary…',
  ended: 'Call ended',
};

export default function CallPanel({ agent }) {
  const { status, caption, lastLatencyMs, support } = agent;
  const [draft, setDraft] = useState('');
  const live = ['listening', 'thinking', 'speaking'].includes(status);
  const busy = status === 'connecting' || status === 'ending';

  const submit = (e) => {
    e.preventDefault();
    agent.sendText(draft);
    setDraft('');
  };

  return (
    <section className="card call-panel">
      <div className="call-top">
        <div className={`orb orb-${status}`} aria-hidden="true">
          <span className="orb-core">A</span>
        </div>
        <div className="call-meta">
          <h2>Aria</h2>
          <p className="muted">Customer Support · Aura Skincare</p>
          <p className="status-line" role="status" aria-live="polite">
            {STATUS_TEXT[status]}
          </p>
        </div>
        <div className="call-actions">
          {live || busy ? (
            <button className="btn btn-end" onClick={agent.end} disabled={busy}>
              End Call
            </button>
          ) : (
            <button className="btn btn-start" onClick={agent.start}>
              {status === 'ended' ? 'Start New Call' : 'Start Call'}
            </button>
          )}
        </div>
      </div>

      <ol className="state-steps" aria-label="Agent state">
        {STATES.map((s) => (
          <li key={s.key} className={status === s.key ? `active step-${s.key}` : ''}>
            <span className="dot" />
            {s.label}
          </li>
        ))}
        {lastLatencyMs != null && live && (
          <li className="latency" title="Time from the end of your turn to the first word of Aria's reply">
            last reply in {(lastLatencyMs / 1000).toFixed(1)}s
          </li>
        )}
      </ol>

      {live && (
        <div className={`caption ${caption ? '' : 'caption-empty'}`}>
          {caption || (status === 'listening' ? (support.stt ? 'Listening…' : 'Type your message below') : ' ')}
        </div>
      )}

      {live && (
        <form className="type-row" onSubmit={submit}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Or type a message (e.g. where is ORD-101?)"
            aria-label="Type a message to Aria"
          />
          <button className="btn btn-ghost" type="submit" disabled={!draft.trim()}>
            Send
          </button>
          {status === 'speaking' && (
            <button className="btn btn-ghost" type="button" onClick={agent.interrupt}>
              Interrupt
            </button>
          )}
        </form>
      )}

      <details className="settings">
        <summary>Voice settings</summary>
        <label>
          Aria&apos;s voice
          <select value={agent.voiceName} onChange={(e) => agent.setVoiceName(e.target.value)}>
            {agent.voices.length === 0 && <option value="">Browser default</option>}
            {agent.voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={agent.bargeIn} onChange={(e) => agent.setBargeIn(e.target.checked)} />
          Let me interrupt Aria by speaking (best with headphones)
        </label>
        <p className="muted small">
          Tip: Microsoft Edge has the most natural Indian English voice (Neerja). Chrome falls back to its Hindi voice.
        </p>
      </details>
    </section>
  );
}
