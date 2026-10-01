import { useEffect, useRef } from 'react';

function toolSummary({ name, input, result, isError }) {
  const arg = input?.order_id ?? input?.issue_summary ?? '';
  let outcome = '';
  if (isError) outcome = 'error';
  else if (result?.found === false) outcome = result.reason === 'NOT_FOUND' ? `not found (${result.searched_for})` : 'invalid ID';
  else if (result?.order?.status && name === 'get_order_details') outcome = result.order.status;
  else if ('eligible' in (result ?? {})) outcome = result.eligible === null ? 'needs more info' : result.eligible ? 'eligible' : 'not eligible';
  else if ('cancelled' in (result ?? {})) outcome = result.cancelled ? 'cancelled' : 'not allowed';
  else if (result?.ticket_id) outcome = result.ticket_id;
  return { label: `${name}(${arg ? JSON.stringify(arg) : ''})`, outcome };
}

export default function Transcript({ entries, title = 'Live transcript', emptyHint }) {
  const listRef = useRef(null);
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [entries]);

  return (
    <section className="card transcript">
      <h3>{title}</h3>
      {entries.length === 0 ? (
        <p className="muted empty">{emptyHint ?? 'Start a call and the conversation will appear here.'}</p>
      ) : (
        <ul ref={listRef}>
          {entries.map((e, i) => {
            if (e.role === 'tool') {
              const { label, outcome } = toolSummary(e.tool);
              return (
                <li key={e.id ?? i} className="entry entry-tool">
                  <span className="tool-chip">
                    <code>{label}</code> → {outcome}
                  </span>
                </li>
              );
            }
            if (e.role === 'event') {
              return (
                <li key={e.id ?? i} className="entry entry-event">
                  {e.text}
                </li>
              );
            }
            return (
              <li key={e.id ?? i} className={`entry entry-${e.role}`}>
                <span className="who">{e.role === 'customer' ? 'You' : 'Aria'}</span>
                <p>
                  {e.text || <span className="typing">…</span>}
                  {e.interrupted && <span className="tag">interrupted</span>}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
