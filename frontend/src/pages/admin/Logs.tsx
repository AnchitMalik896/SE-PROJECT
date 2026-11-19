import { useState } from 'react';
import { get } from '../../api';
import { dateTime, label } from '../../format';
import { useDebounced, useLoad } from '../../hooks';
import type { AuditLogRow, Paged } from '../../types';
import { Async, Empty, Field, Glass, PageHead, Pagination } from '../../ui';
import { DateRange } from './common';

export default function Logs() {
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const L = useLoad(() => get<Paged<AuditLogRow>>('/admin/logs', { search: q, from, to, page }), [q, from, to, page]);

  return (
    <div className="stack">
      <PageHead title="Activity logs" subtitle="Logins and key administrator actions" />
      <div className="filters">
        <Field className="grow" label="Search" type="search" placeholder="User name, email or action" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); setPage(1); }} />
      </div>
      <Glass>
        <Async loading={L.loading && !L.data} error={L.error} onRetry={L.reload}>
          {L.data && (L.data.items.length === 0 ? <Empty icon="🧾" title="No log entries match" /> : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead>
                  <tbody>
                    {L.data.items.map((r) => (
                      <tr key={r.id}>
                        <td className="small" style={{ whiteSpace: 'nowrap' }}>{dateTime(r.createdAt)}</td>
                        <td>{r.actor ? <>{r.actor.name}<div className="small muted">{label(r.actor.role)}</div></> : <span className="muted">System</span>}</td>
                        <td><span className="badge info">{r.action}</span></td>
                        <td className="small wrap-text">{r.entity ?? '—'}</td>
                        <td className="small wrap-text">{r.detail ?? '—'}</td>
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
