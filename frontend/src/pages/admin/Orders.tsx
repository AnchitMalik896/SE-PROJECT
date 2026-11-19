import { Fragment, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, post } from '../../api';
import { dateTime, label, money } from '../../format';
import { errMsg, useDebounced, useLoad } from '../../hooks';
import type { AdminUser, Order, Paged } from '../../types';
import { Async, Button, ConfirmDialog, Empty, Field, Glass, PageHead, Pagination, Select, StatusBadge, useToast } from '../../ui';

export default function Orders() {
  const toast = useToast();
  const [sp] = useSearchParams();
  const [status, setStatus] = useState('');
  const [payment, setPayment] = useState('');
  const [search, setSearch] = useState('');
  const [stuck, setStuck] = useState(sp.get('attention') === '1');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const L = useLoad(() => get<Paged<Order>>('/admin/orders', { status, paymentStatus: payment, search: q, stuck: stuck ? 'true' : undefined, page }), [status, payment, q, stuck, page]);
  const couriers = useLoad(() => get<Paged<AdminUser>>('/admin/users', { role: 'DELIVERY', status: 'ACTIVE', pageSize: 100 }), []);
  const [open, setOpen] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const [assignee, setAssignee] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const assign = async (o: Order) => {
    const pid = assignee[o.id];
    if (!pid || !o.delivery) return toast.error('Choose a delivery partner first');
    setBusy(o.id);
    try {
      await post(`/admin/deliveries/${o.delivery.id}/assign`, { deliveryPersonId: pid });
      toast.ok('Delivery assigned');
      await L.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  return (
    <div className="stack">
      <PageHead title="Orders" subtitle="Monitor every order and step in when something goes wrong" />
      <div className="filters">
        <Field className="grow" label="Search" type="search" placeholder="Order ref, customer or farmer" value={search} onChange={(e) => reset(setSearch)(e.target.value)} />
        <Select label="Order status" value={status} onChange={(e) => reset(setStatus)(e.target.value)}>
          <option value="">All</option>
          {['PLACED', 'ACCEPTED', 'PACKED', 'DISPATCHED', 'DELIVERED', 'CANCELLED'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </Select>
        <Select label="Payment" value={payment} onChange={(e) => reset(setPayment)(e.target.value)}>
          <option value="">All</option>
          {['PENDING', 'PAID', 'FAILED', 'REFUNDED'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </Select>
        <label className="checkbox" style={{ minHeight: 44 }}>
          <input type="checkbox" checked={stuck} onChange={(e) => reset(setStuck)(e.target.checked)} /> Needs attention only
        </label>
      </div>

      <Glass>
        <Async loading={L.loading && !L.data} error={L.error} onRetry={L.reload}>
          {L.data && (L.data.items.length === 0 ? <Empty icon="📦" title={stuck ? 'Nothing needs attention 🎉' : 'No orders found'} /> : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Order</th><th>Customer</th><th>Farm</th><th>Total</th><th>Status</th><th>Placed</th><th><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {L.data.items.map((o) => {
                      const isOpen = open === o.id;
                      const canCancel = o.status !== 'DELIVERED' && o.status !== 'CANCELLED';
                      const canAssign = o.status === 'PACKED' && o.delivery?.status === 'UNASSIGNED';
                      return (
                        <Fragment key={o.id}>
                          <tr>
                            <td><strong>#{o.ref}</strong></td>
                            <td>{o.consumer?.name}</td>
                            <td>{o.farmer.farmName}</td>
                            <td>{money(o.total)}</td>
                            <td>
                              <div className="row" style={{ gap: '0.3rem' }}><StatusBadge status={o.status} /><StatusBadge status={o.paymentStatus} /></div>
                              {o.flags && o.flags.length > 0 && <div className="flags">{o.flags.map((f) => <span key={f} className="badge warn">⚠ {f}</span>)}</div>}
                            </td>
                            <td className="small">{dateTime(o.createdAt)}</td>
                            <td><Button size="sm" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : o.id)}>{isOpen ? 'Hide' : 'Details'}</Button></td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td colSpan={7}>
                                <div className="detail-box stack">
                                  <div className="grid cols-2">
                                    <div>
                                      <h3>Items</h3>
                                      <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>{o.items.map((i) => <li key={i.productId}>{i.quantity} × {i.name} — {money(i.unitPrice * i.quantity)}</li>)}</ul>
                                      <p className="small muted" style={{ marginTop: '0.5rem' }}>Subtotal {money(o.subtotal)} + delivery {money(o.deliveryFee)}{o.refunded > 0 && <> · Refunded {money(o.refunded)}</>}</p>
                                    </div>
                                    <dl className="kv small" style={{ margin: 0 }}>
                                      <dt>Deliver to</dt><dd className="wrap-text">{o.deliveryAddress}</dd>
                                      <dt>Payout</dt><dd>{o.payoutStatus ? label(o.payoutStatus) : '—'}</dd>
                                      <dt>Delivery</dt><dd>{o.delivery ? <StatusBadge status={o.delivery.status} /> : 'Not created yet'}</dd>
                                      <dt>Partner</dt><dd>{o.delivery?.assignedTo ? `${o.delivery.assignedTo.name} · ${o.delivery.assignedTo.phone}` : '—'}</dd>
                                      {o.delivery?.failureReason && (<><dt>Problem</dt><dd className="wrap-text" style={{ color: 'var(--danger)' }}>{o.delivery.failureReason}</dd></>)}
                                      {o.cancelReason && (<><dt>Cancelled</dt><dd className="wrap-text">{o.cancelReason}</dd></>)}
                                    </dl>
                                  </div>
                                  <div className="row">
                                    {canAssign && (
                                      <>
                                        <Select label="Assign delivery partner" value={assignee[o.id] ?? ''} onChange={(e) => setAssignee({ ...assignee, [o.id]: e.target.value })}>
                                          <option value="">Choose…</option>
                                          {couriers.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </Select>
                                        <Button variant="primary" size="sm" busy={busy === o.id} onClick={() => assign(o)}>Assign</Button>
                                      </>
                                    )}
                                    {canCancel && <Button variant="danger" size="sm" onClick={() => setCancelling(o)}>Cancel &amp; refund</Button>}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination data={L.data} onPage={setPage} />
            </>
          ))}
        </Async>
      </Glass>

      {cancelling && (
        <ConfirmDialog
          title={`Cancel order #${cancelling.ref}?`}
          message={cancelling.paymentStatus === 'PAID' ? 'Stock is restored and the customer is refunded in full. This cannot be undone.' : 'Stock is restored. The order was not paid, so no refund is needed.'}
          confirmText="Cancel order"
          danger
          reasonLabel="Reason (shared with the customer)"
          onClose={() => setCancelling(null)}
          onConfirm={async (reason) => {
            await post(`/admin/orders/${cancelling.id}/cancel-refund`, { reason });
            toast.ok(`Order #${cancelling.ref} cancelled`);
            await L.reload();
          }}
        />
      )}
    </div>
  );
}
