import { useState } from 'react';
import { get, patch } from '../../api';
import { dateTime, money } from '../../format';
import { errMsg, useLoad } from '../../hooks';
import type { Order, OrderStatus, Paged } from '../../types';
import { Async, Banner, Button, Chips, ConfirmDialog, Empty, Glass, OrderTimeline, Pagination, StatusBadge, useToast } from '../../ui';

type Filter = 'ALL' | OrderStatus;
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ALL', label: 'All' }, { value: 'PLACED', label: 'New' }, { value: 'ACCEPTED', label: 'Accepted' }, { value: 'PACKED', label: 'Packed' },
  { value: 'DISPATCHED', label: 'Out for delivery' }, { value: 'DELIVERED', label: 'Delivered' }, { value: 'CANCELLED', label: 'Cancelled' },
];

function DeliveryInfo({ o }: { o: Order }) {
  const d = o.delivery;
  if (!d) return null;
  return (
    <div className="banner info">
      <strong>Delivery: </strong><StatusBadge status={d.status} /> · ready since {dateTime(d.readyAt)}
      <div className="small">
        {d.assignedTo ? <>Partner: <strong>{d.assignedTo.name}</strong> · <a href={`tel:${d.assignedTo.phone}`}>{d.assignedTo.phone}</a></> : 'Waiting for a delivery partner to accept'}
      </div>
    </div>
  );
}

function OrderCard({ o, onChanged }: { o: Order; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const advance = async (status: 'ACCEPTED' | 'PACKED') => {
    setBusy(true);
    try {
      await patch(`/farmer/orders/${o.id}/status`, { status });
      toast.ok(status === 'ACCEPTED' ? 'Order accepted' : 'Marked as packed — delivery partners can now pick it up');
      onChanged();
    } catch (e) {
      toast.error(errMsg(e));
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const canAct = o.status === 'PLACED' || o.status === 'ACCEPTED';

  return (
    <Glass className="f-order">
      <div className="row between">
        <div>
          <h3 style={{ margin: 0 }}>Order #{o.ref}</h3>
          <div className="small muted">{dateTime(o.createdAt)} · {o.consumer?.name ?? 'Customer'}</div>
        </div>
        <StatusBadge status={o.status} />
      </div>
      <OrderTimeline status={o.status} />
      <ul className="f-items">{o.items.map((i) => <li key={i.productId}>{i.quantity} × {i.name} <span className="muted">({money(i.unitPrice)} / {i.unit})</span></li>)}</ul>
      <div className="row between">
        <span>You earn: <strong>{money(o.subtotal)}</strong> <span className="small muted">(delivery fee isn't included)</span></span>
        {o.payoutStatus && <span className={`badge ${o.payoutStatus === 'RELEASED' ? 'ok' : o.payoutStatus === 'REFUNDED' ? 'danger' : 'warn'}`}>Payout: {o.payoutStatus.toLowerCase()}</span>}
      </div>
      {(o.status === 'PACKED' || o.status === 'DISPATCHED' || o.status === 'DELIVERED') && <DeliveryInfo o={o} />}
      {o.status === 'CANCELLED' && <Banner kind="warn">Cancelled{o.cancelReason ? `: ${o.cancelReason}` : ''}{o.refunded ? ` · ${money(o.refunded)} refunded to the customer` : ''}</Banner>}
      {canAct && (
        <>
          <div className="row">
            {o.status === 'PLACED' && <Button variant="primary" busy={busy} onClick={() => advance('ACCEPTED')}>Accept order</Button>}
            {o.status === 'ACCEPTED' && <Button variant="primary" busy={busy} onClick={() => advance('PACKED')}>Mark as packed</Button>}
            <Button variant="danger" onClick={() => setCancelling(true)}>Cancel order</Button>
          </div>
          <span className="small muted">You can cancel only until the order is packed. The customer is refunded automatically.</span>
        </>
      )}
      {cancelling && (
        <ConfirmDialog
          title={`Cancel order #${o.ref}?`}
          message="The customer will be notified and refunded, and the stock goes back on sale."
          reasonLabel="Reason for cancelling"
          confirmText="Cancel order"
          danger
          onClose={() => setCancelling(false)}
          onConfirm={async (reason) => {
            try {
              await patch(`/farmer/orders/${o.id}/status`, { status: 'CANCELLED', reason });
            } catch (e) {
              throw new Error(errMsg(e));
            }
            toast.ok('Order cancelled');
            onChanged();
          }}
        />
      )}
    </Glass>
  );
}

export function FarmerOrders() {
  const [status, setStatus] = useState<Filter>('ALL');
  const [page, setPage] = useState(1);
  const list = useLoad(() => get<Paged<Order>>('/farmer/orders', { status: status === 'ALL' ? '' : status, page }), [status, page], 20_000);

  return (
    <>
      <div className="page-head"><div><h1>Orders</h1><p>Only paid orders appear here.</p></div></div>
      <div style={{ marginBottom: '1rem' }}><Chips value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={FILTERS} /></div>
      <Async loading={list.loading} error={list.error} onRetry={list.reload}>
        {list.data && list.data.items.length === 0 ? (
          <Glass><Empty icon="📦" title="No orders here">New paid orders will show up automatically.</Empty></Glass>
        ) : (
          <div className="stack">
            {list.data?.items.map((o) => <OrderCard key={o.id} o={o} onChanged={list.reload} />)}
            {list.data && <Pagination data={list.data} onPage={setPage} />}
          </div>
        )}
      </Async>
    </>
  );
}
