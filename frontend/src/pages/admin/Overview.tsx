import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../../api';
import { dateOnly, label, money } from '../../format';
import { useLoad } from '../../hooks';
import type { Paged, Order } from '../../types';
import { Async, Empty, Glass, PageHead, Stat, StatusBadge } from '../../ui';
import { DateRange, daysAgo, isoDay } from './common';

interface Analytics {
  users: Record<string, number>;
  activeUsers: number;
  orders: { total: number; byStatus: Record<string, number> };
  revenue: number;
  sales: number;
  farmerIncome: number;
  series: { date: string; orders: number; revenue: number }[];
}

function Chart({ series }: { series: Analytics['series'] }) {
  const W = 720, H = 230, L = 38, R = 44, T = 14, B = 30;
  const n = series.length;
  const maxO = Math.max(1, ...series.map((s) => s.orders));
  const maxR = Math.max(1, ...series.map((s) => s.revenue));
  const slot = (W - L - R) / n;
  const bw = Math.min(36, slot * 0.6);
  const x = (i: number) => L + slot * i + slot / 2;
  const yO = (v: number) => T + (H - T - B) * (1 - v / maxO);
  const yR = (v: number) => T + (H - T - B) * (1 - v / maxR);
  const total = series.reduce((s, d) => s + d.orders, 0);
  const summary = `Orders per day: ${total} orders across ${n} days with orders, from ${series[0].date} to ${series[n - 1].date}. Revenue is shown as a line.`;
  const tickEvery = Math.max(1, Math.ceil(n / 8));
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={T + (H - T - B) * (1 - t)} y2={T + (H - T - B) * (1 - t)} stroke="currentColor" opacity={0.12} />
            <text x={L - 6} y={T + (H - T - B) * (1 - t) + 4} textAnchor="end">{Math.round(maxO * t)}</text>
            <text x={W - R + 6} y={T + (H - T - B) * (1 - t) + 4}>{money(Math.round(maxR * t))}</text>
          </g>
        ))}
        {series.map((d, i) => (
          <g key={d.date}>
            <rect className="bar" x={x(i) - bw / 2} y={yO(d.orders)} width={bw} height={H - B - yO(d.orders)} rx={4}>
              <title>{`${d.date}: ${d.orders} orders, ${money(d.revenue)} revenue`}</title>
            </rect>
            {i % tickEvery === 0 && <text x={x(i)} y={H - 10} textAnchor="middle">{d.date.slice(5)}</text>}
          </g>
        ))}
        {n > 1 && <polyline className="line" points={series.map((d, i) => `${x(i)},${yR(d.revenue)}`).join(' ')} />}
        {series.map((d, i) => <circle key={d.date} className="dot" cx={x(i)} cy={yR(d.revenue)} r={3} />)}
      </svg>
      <div className="legend"><span><i style={{ background: 'var(--accent)' }} />Orders (left axis)</span><span><i style={{ background: 'var(--info)' }} />Revenue (right axis)</span></div>
      <table className="sr-only">
        <caption>Orders and revenue per day</caption>
        <thead><tr><th>Date</th><th>Orders</th><th>Revenue</th></tr></thead>
        <tbody>{series.map((d) => <tr key={d.date}><td>{d.date}</td><td>{d.orders}</td><td>{money(d.revenue)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Attention() {
  const farmers = useLoad(() => get<{ items: unknown[] }>('/admin/farmers/pending'), []);
  const complaints = useLoad(() => get<{ items: unknown[] }>('/admin/complaints', { status: 'OPEN' }), []);
  const flagged = useLoad(() => get<Paged<Order>>('/admin/orders', { stuck: 'true', pageSize: 1 }), []);
  const rows = [
    { to: '/admin/farmers', text: 'Farmers awaiting verification', n: farmers.data?.items.length, err: farmers.error },
    { to: '/admin/complaints', text: 'Open complaints', n: complaints.data?.items.length, err: complaints.error },
    { to: '/admin/orders?attention=1', text: 'Orders needing attention', n: flagged.data?.total, err: flagged.error },
  ];
  return (
    <Glass>
      <h2>Needs attention</h2>
      <div className="stack">
        {rows.map((r) => (
          <Link key={r.to} to={r.to} className={`attn ${r.n ? 'hot' : ''}`}>
            <span>{r.text}</span>
            <span className="n">{r.err ? '!' : r.n ?? '…'}</span>
          </Link>
        ))}
      </div>
    </Glass>
  );
}

export default function Overview() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(isoDay(new Date()));
  const L = useLoad(() => get<Analytics>('/admin/analytics', { from, to }), [from, to]);
  const a = L.data;

  return (
    <div className="stack">
      <PageHead title="Overview" subtitle="How the marketplace is doing" />
      <div className="filters"><DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} /></div>
      <Async loading={L.loading && !a} error={L.error} onRetry={L.reload}>
        {a && (
          <>
            <div className="grid cols-4">
              <Stat label="Customers" value={a.users.CONSUMER ?? 0} />
              <Stat label="Farmers" value={a.users.FARMER ?? 0} />
              <Stat label="Delivery partners" value={a.users.DELIVERY ?? 0} />
              <Stat label="Active users" value={a.activeUsers} hint="Logged in during this period" />
              <Stat label="Orders" value={a.orders.total} />
              <Stat label="Revenue" value={money(a.revenue)} hint="Paid orders incl. delivery fees" />
              <Stat label="Produce sales" value={money(a.sales)} hint="Excluding delivery fees" />
              <Stat label="Farmer income" value={money(a.farmerIncome)} hint="Released after delivery" />
            </div>
            <div className="grid cols-2">
              <Glass>
                <h2>Orders by status</h2>
                {Object.keys(a.orders.byStatus).length === 0 ? <Empty icon="📦" title="No orders in this period" /> : (
                  Object.entries(a.orders.byStatus).sort((x, y) => y[1] - x[1]).map(([s, c]) => (
                    <div className="bar-row" key={s}>
                      <StatusBadge status={s} text={label(s)} />
                      <div className="bar-track" aria-hidden><div className="bar-fill" style={{ width: `${(c / a.orders.total) * 100}%` }} /></div>
                      <strong>{c}</strong>
                    </div>
                  ))
                )}
              </Glass>
              <Attention />
            </div>
            <Glass>
              <h2>Orders per day</h2>
              <p className="small muted">{dateOnly(from)} – {dateOnly(to)}</p>
              {a.series.length === 0 ? <Empty icon="📈" title="No orders to chart yet" /> : <Chart series={a.series} />}
            </Glass>
          </>
        )}
      </Async>
    </div>
  );
}
