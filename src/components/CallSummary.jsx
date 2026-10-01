import { useState } from 'react';
import Transcript from './Transcript.jsx';

const pretty = (s) => (s ? s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '—');

export default function CallSummary({ result }) {
  const [copied, setCopied] = useState(false);
  const { outcome, meta, transcript } = result;
  const json = JSON.stringify(outcome, null, 2);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked; the JSON is still selectable
    }
  };

  return (
    <div className="summary">
      <section className="card">
        <div className="summary-head">
          <h3>Call outcome</h3>
          <span className="muted small">
            {meta.duration_seconds}s · {meta.customer_turns} customer turns · summary by {meta.summary_generated_by === 'llm' ? meta.model : 'rules (fallback)'}
          </span>
        </div>

        <div className="kpis">
          <div>
            <span className="muted small">Intent</span>
            <strong>{pretty(outcome.customer_intent)}</strong>
          </div>
          <div>
            <span className="muted small">Order</span>
            <strong>{outcome.order_id ?? '—'}</strong>
          </div>
          <div>
            <span className="muted small">Resolution</span>
            <strong className={`res res-${outcome.resolution_status}`}>{pretty(outcome.resolution_status)}</strong>
          </div>
          <div>
            <span className="muted small">Sentiment</span>
            <strong>{pretty(outcome.customer_sentiment)}</strong>
          </div>
        </div>

        <p className="summary-text">{outcome.call_summary}</p>

        <div className="json-head">
          <span className="muted small">Structured outcome (JSON)</span>
          <button className="btn btn-ghost btn-small" onClick={copy}>
            {copied ? 'Copied' : 'Copy JSON'}
          </button>
        </div>
        <pre className="json">{json}</pre>
      </section>

      <Transcript entries={transcript} title="Call transcript" />
    </div>
  );
}
