// Empty in dev (Vite proxies /api) and in the single-service deploy.
// Set VITE_API_URL when the API is hosted separately.
const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

async function json(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export const getOrders = () => fetch(`${API_URL}/api/orders`).then(json);
export const getHealth = () => fetch(`${API_URL}/api/health`).then(json);
export const startCall = () => fetch(`${API_URL}/api/calls`, { method: 'POST' }).then(json);
export const endCall = (callId) => fetch(`${API_URL}/api/calls/${callId}/end`, { method: 'POST' }).then(json);

// POST a turn and read the Server-Sent Events stream it returns.
// EventSource only supports GET, so the stream is parsed by hand.
export async function streamTurn(callId, payload, { signal, onEvent }) {
  const res = await fetch(`${API_URL}/api/calls/${callId}/turns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok || !res.body) await json(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = 'message';
      let data = '';
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (data) onEvent(event, JSON.parse(data));
    }
  }
}











