import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../../api';
import { dateTime, money } from '../../format';
import { useLoad } from '../../hooks';
import type { Order, Paged } from '../../types';
import { Async, Chips, Empty, Glass, OrderTimeline, PageHead, Pagination, StatusBadge } from '../../ui';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'PLACED', label: 'Placed' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'PACKED', label: 'Packed' },
  { value: 'DISPATCHED', label: 'Out for delivery' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export function Orders() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const list = useLoad(() => get<Paged<Order>>('/orders', { status, page }), [status, page]);

  return (
    <>
      <PageHead title="My orders" subtitle="Track deliveries and revisit past orders." />
      <div style={{ marginBottom: '1rem' }}>
        <Chips value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={FILTERS} />
      </div>
      <Async loading={list.loading} error={list.error} onRetry={list.reload}>
        {list.data && list.data.items.length === 0 ? (
          <Glass><Empty icon="📦" title="No orders here yet"><Link className="btn primary" to="/shop">Start shopping</Link></Empty></Glass>
        ) : (
          list.data && (
            <>
              <div className="stack">
                {list.data.items.map((o) => {
                  const unpaid = (o.paymentStatus === 'PENDING' || o.paymentStatus === 'FAILED') && o.status !== 'CANCELLED';
                  return (
                    <Glass key={o.id} as="article" hover aria-label={`Order ${o.ref}`}>
                      <div className="row between">
                        <div>
                          <h3 style={{ margin: 0 }}><Link to={`/orders/${o.id}`} style={{ color: 'inherit' }}>Order #{o.ref}</Link></h3>
                          <div className="small muted">{dateTime(o.createdAt)} · {o.farmer.farmName}</div>
                        </div>
                        <div className="row">
                          <StatusBadge status={o.paymentStatus} text={`Payment: ${o.paymentStatus.toLowerCase()}`} />
                          <strong>{money(o.total)}</strong>
                        </div>
                      </div>
                      <p className="small" style={{ margin: '0.6rem 0' }}>{o.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}</p>
                      <div className="row between">
                        <OrderTimeline status={o.status} />
                        <div className="row">
                          {unpaid && <Link className="btn primary sm" to={`/pay/${o.groupId}`}>Pay now</Link>}
                          <Link className="btn sm" to={`/orders/${o.id}`}>Details</Link>
                        </div>
                      </div>
                    </Glass>
                  );
                })}
              </div>
              <Pagination data={list.data} onPage={setPage} />
            </>
          )
        )}
      </Async>
    </>
  );
}
