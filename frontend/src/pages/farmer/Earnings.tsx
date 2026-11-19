import { useState } from 'react';
import { get } from '../../api';
import { dateTime, money } from '../../format';
import { useLoad } from '../../hooks';
import { Async, Banner, Button, Empty, Field, Glass, PageHead, Stat } from '../../ui';

interface Earnings {
  total: number;
  pendingPayout: number;
  pendingOrders: number;
  items: { id: string; orderId: string; orderRef: string; amount: number; createdAt: string; items: string[] }[];
}

export function Earnings() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const bad = !!from && !!to && from > to;
  const data = useLoad(() => (bad ? Promise.resolve(null) : get<Earnings>('/farmer/earnings', { from, to })), [from, to, bad]);

  return (
    <>
      <PageHead title="Earnings" subtitle="Payment is released to you after the customer's delivery is confirmed with their OTP." />
      <Glass style={{ marginBottom: '1rem' }}>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Field label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <Button onClick={() => { setFrom(''); setTo(''); }} disabled={!from && !to}>Clear</Button>
        </div>
        {bad && <div style={{ marginTop: '0.75rem' }}><Banner kind="error">“From” must be on or before “To”.</Banner></div>}
      </Glass>
      <Async loading={data.loading} error={data.error} onRetry={data.reload}>
        {data.data && (
          <div className="stack">
            <div className="grid cols-2">
              <Stat label={from || to ? 'Earned in this period' : 'Total earned'} value={money(data.data.total)} tone="ok" />
              <Stat label="Pending payout" value={money(data.data.pendingPayout)} hint={`${data.data.pendingOrders} order${data.data.pendingOrders === 1 ? '' : 's'} not yet delivered`} />
            </div>
            <Glass>
              <h2>Transactions</h2>
              {data.data.items.length === 0 ? (
                <Empty icon="💰" title="No earnings in this period" />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Date</th><th>Order</th><th>Items</th><th className="right">Amount</th></tr></thead>
                    <tbody>
                      {data.data.items.map((t) => (
                        <tr key={t.id}>
                          <td>{dateTime(t.createdAt)}</td>
                          <td>#{t.orderRef}</td>
                          <td>{t.items.join(', ')}</td>
                          <td className="right"><strong>{money(t.amount)}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Glass>
          </div>
        )}
      </Async>
    </>
  );
}
