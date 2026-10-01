import { useEffect, useState } from 'react';
import { getOrders } from '../lib/api.js';

const STATUS_CLASS = {
  'Out for Delivery': 'badge-transit',
  Delivered: 'badge-delivered',
  Processing: 'badge-processing',
};

const TRY_SAYING = [
  { label: 'Order lookup', text: 'Where is my order ORD-101?' },
  { label: 'Return, outside policy', text: 'I bought this 20 days ago and have opened it. Can I return it?' },
  { label: 'Cancellation', text: 'I want to cancel order ORD-103.' },
  { label: 'Cancel not allowed', text: 'Please cancel ORD-101.' },
  { label: 'Invalid order', text: 'Can you check order ORD-999?' },
  { label: 'Missing order ID', text: 'Where is my order?' },
  { label: 'Out of scope', text: 'Can you book me a flight to Goa?' },
  { label: 'Hinglish', text: 'Mera order ORD-102 kab deliver hua tha?' },
  { label: 'Policy question', text: 'Do you offer cash on delivery?' },
];

export default function TestOrders() {
  const [orders, setOrders] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getOrders()
      .then(setOrders)
      .catch(() => setFailed(true));
  }, []);

  return (
    <>
      <section className="card">
        <h3>Test orders</h3>
        <p className="muted small">Say or type any of these IDs during the call.</p>
        {failed && <p className="error-text">Couldn&apos;t load orders — is the backend running?</p>}
        {!orders && !failed && <p className="muted">Loading…</p>}
        <div className="orders">
          {orders?.map((o) => (
            <article key={o.order_id} className="order">
              <header>
                <strong>{o.order_id}</strong>
                <span className={`badge ${STATUS_CLASS[o.status] ?? ''}`}>{o.status}</span>
              </header>
              <dl>
                <dt>Customer</dt>
                <dd>{o.customer_name}</dd>
                <dt>Product</dt>
                <dd>{o.product}</dd>
                <dt>Value</dt>
                <dd>₹{o.value_inr}</dd>
              </dl>
              <p className="order-notes">{o.notes}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>Try saying</h3>
        <ul className="try-list">
          {TRY_SAYING.map((t) => (
            <li key={t.label}>
              <span className="muted small">{t.label}</span>
              <q>{t.text}</q>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
