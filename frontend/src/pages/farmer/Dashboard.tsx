import { Link } from 'react-router-dom';
import { get } from '../../api';
import { money } from '../../format';
import { useLoad } from '../../hooks';
import { Async, Empty, Glass, PageHead, Stat } from '../../ui';

interface Stats {
  orders: Record<string, number>;
  lowStock: { id: string; name: string; stock: number; unit: string }[];
  totalEarnings: number;
}

export function Dashboard() {
  const s = useLoad(() => get<Stats>('/farmer/stats'));
  const o = s.data?.orders ?? {};
  const inProgress = (o.ACCEPTED ?? 0) + (o.PACKED ?? 0) + (o.DISPATCHED ?? 0);
  return (
    <>
      <PageHead title="Farm dashboard" subtitle="What needs your attention today" />
      <Async loading={s.loading} error={s.error} onRetry={s.reload}>
        {s.data && (
          <div className="stack">
            <div className="grid cols-4">
              <Stat label="Awaiting your action" value={o.PLACED ?? 0} tone={(o.PLACED ?? 0) > 0 ? 'warn' : undefined} hint="New paid orders to accept" />
              <Stat label="In progress" value={inProgress} hint="Accepted, packed or out for delivery" />
              <Stat label="Delivered" value={o.DELIVERED ?? 0} tone="ok" />
              <Stat label="Total earnings" value={money(s.data.totalEarnings)} hint="Released after delivery" />
            </div>
            <div className="grid cols-2">
              <Glass>
                <h2>Low stock</h2>
                {s.data.lowStock.length === 0 ? (
                  <Empty icon="✅" title="Stock looks healthy" />
                ) : (
                  <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {s.data.lowStock.map((p) => (
                      <li key={p.id} className="row between">
                        <span>{p.name}</span>
                        <span className="badge warn">{p.stock === 0 ? 'Out of stock' : `${p.stock} ${p.unit} left`}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p style={{ marginTop: '1rem' }}><Link to="/farmer/inventory">Update inventory →</Link></p>
              </Glass>
              <Glass>
                <h2>Quick links</h2>
                <div className="stack">
                  <Link className="btn" to="/farmer/orders">📦 Manage orders</Link>
                  <Link className="btn" to="/farmer/products">🥕 Add or edit products</Link>
                  <Link className="btn" to="/farmer/earnings">💰 View earnings</Link>
                  <Link className="btn" to="/profile">👤 Farm profile</Link>
                </div>
              </Glass>
            </div>
          </div>
        )}
      </Async>
    </>
  );
}
