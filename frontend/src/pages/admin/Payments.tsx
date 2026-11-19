import { useState } from 'react';
import { get } from '../../api';
import { dateTime, money } from '../../format';
import { useLoad } from '../../hooks';
import type { Paged } from '../../types';
import { Async, Chips, Empty, Glass, PageHead, Pagination, StatusBadge } from '../../ui';
import { DateRange } from './common';

interface PaymentRow {
  id: string;
  groupId: string;
  consumerName: string;
  amount: number;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  failureReason: string | null;
  attempts: number;
  refundedAmount: number;
  orderRefs: string[];
  createdAt: string;
}

export default function Payments() {
  const [status, setStatus] = useState('');
  const [refunded, setRefunded] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const L = useLoad(() => get<Paged<PaymentRow>>('/admin/payments', { status, refunded: refunded ? 'true' : undefined, from, to, page }), [status, refunded, from, to, page]);

  return (
    <div className="stack">
      <PageHead title="Payments" subtitle="Every payment attempt, failure and refund" />
      <div className="filters">
        <Chips value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: '', label: 'All' }, { value: 'PENDING', label: 'Pending' }, { value: 'SUCCESS', label: 'Success' }, { value: 'FAILED', label: 'Failed' }]} />
        <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); setPage(1); }} />
        <label className="checkbox" style={{ minHeight: 44 }}>
          <input type="checkbox" checked={refunded} onChange={(e) => { setRefunded(e.target.checked); setPage(1); }} /> Refunded only
        </label>
      </div>
      <Glass>
        <Async loading={L.loading && !L.data} error={L.error} onRetry={L.reload}>
          {L.data && (L.data.items.length === 0 ? <Empty icon="💳" title="No payments match these filters" /> : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Date</th><th>Customer</th><th>Orders</th><th>Amount</th><th>Status</th><th>Attempts</th><th>Refunded</th><th>Failure reason</th></tr></thead>
                  <tbody>
                    {L.data.items.map((p) => (
                      <tr key={p.id}>
                        <td className="small">{dateTime(p.createdAt)}</td>
                        <td>{p.consumerName}</td>
                        <td>{p.orderRefs.map((r) => `#${r}`).join(', ') || '—'}</td>
                        <td>{money(p.amount)}</td>
                        <td><StatusBadge status={p.status} /></td>
                        <td>{p.attempts}</td>
                        <td>{p.refundedAmount > 0 ? <StatusBadge status="REFUNDED" text={money(p.refundedAmount)} /> : '—'}</td>
                        <td className="small wrap-text">{p.failureReason ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination data={L.data} onPage={setPage} />
            </>
          ))}
        </Async>
      </Glass>
    </div>
  );
}
