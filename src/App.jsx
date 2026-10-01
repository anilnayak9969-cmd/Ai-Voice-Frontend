import { useEffect, useState } from 'react';
import './App.css';
import CallPanel from './components/CallPanel.jsx';
import CallSummary from './components/CallSummary.jsx';
import TestOrders from './components/TestOrders.jsx';
import Transcript from './components/Transcript.jsx';
import { useVoiceAgent } from './hooks/useVoiceAgent.js';
import { getHealth } from './lib/api.js';

export default function App() {
  const agent = useVoiceAgent();
  const [health, setHealth] = useState(null);

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch(() => setHealth({ ok: false }));
  }, []);

  const showSummary = agent.result && agent.status === 'ended';

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>
            Aura Skincare <span className="muted">· Voice Support</span>
          </h1>
          <p className="muted small">Talk to Aria, our AI support agent. Click Start Call and allow microphone access.</p>
        </div>
        {health && (
          <span className={`health ${health.ok && health.llmConfigured ? 'ok' : 'bad'}`}>
            {health.ok ? (health.llmConfigured ? `API online · ${health.model}` : 'API online · no LLM key') : 'API offline'}
          </span>
        )}
      </header>

      {agent.error && (
        <div className="alert" role="alert">
          <span>{agent.error}</span>
          <button className="btn btn-ghost btn-small" onClick={agent.dismissError}>
            Dismiss
          </button>
        </div>
      )}

      <main className="layout">
        <div className="col-main">
          <CallPanel agent={agent} />
          {showSummary ? (
            <CallSummary result={agent.result} />
          ) : (
            <Transcript entries={agent.transcript} />
          )}
        </div>
        <aside className="col-side">
          <TestOrders />
        </aside>
      </main>

      <footer className="muted small">
        Speech runs in your browser (Web Speech API) · Reasoning and tool calls by Claude on a Node.js backend.
      </footer>
    </div>
  );
}
