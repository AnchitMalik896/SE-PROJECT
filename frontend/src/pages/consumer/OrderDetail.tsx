import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post } from '../../api';
import { dateTime, mapsPoint, money, timeAgo } from '../../format';
import { errMsg, useLoad } from '../../hooks';
import type { Order, OrderItem } from '../../types';
import { Async, Banner, Button, ConfirmDialog, Glass, OrderTimeline, PageHead, StarPicker, StatusBadge, TextArea, useToast } from '../../ui';

function RateItem({ order, item, onDone }: { order: Order; item: OrderItem; onDone: () => void }) {
  const toast = useToast();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!stars) return toast.error('Choose 1–5 stars first');
    setBusy(true);
    try {
      await post(`/orders/${order.id}/rate`, { productId: item.productId, stars, comment: comment.trim() || undefined });
      toast.ok('Thanks for your rating!');
      onDone();
    } catch (e) {
      toast.error(errMsg(e));
      setBusy(false);
    }
  };
  return (
    <div className="stack" style={{ padding: '0.6rem 0', borderTop: '1px solid var(--glass-edge)' }}>
      <strong>{item.name}</strong>
      <StarPicker value={stars} onChange={setStars} />
      <TextArea label="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} style={{ minHeight: 64 }} />
      <div><Button size="sm" variant="primary" busy={busy} onClick={submit}>Submit rating</Button></div>
    </div>
  );
}

export function OrderDetail() {
  const { id = '' } = useParams();
  const toast = useToast();
  const data = useLoad(() => get<{ order: Order }>(`/orders/${id}`), [id], 10_000);
  const [cancelling, setCancelling] = useState(false);
  const o = data.data?.order;

  const cancel = async (reason: string) => {
    const r = await post<{ message: string }>(`/orders/${id}/cancel`, { reason: reason || undefined });
    toast.ok(r.message);
    await data.reload();
  };

  const unpaid = o && (o.paymentStatus === 'PENDING' || o.paymentStatus === 'FAILED') && o.status !== 'CANCELLED';
  const loc = o?.delivery?.location;
  const toRate = o && o.status === 'DELIVERED' ? o.items.filter((i) => !o.ratedProductIds.includes(i.productId)) : [];

  return (
    <>
      <p><Link to="/orders">← All orders</Link></p>
      <Async loading={data.loading} error={data.error} onRetry={data.reload}>
        {o && (
          <div className="stack">
            <PageHead
              title={`Order #${o.ref}`}
              subtitle={`Placed ${dateTime(o.createdAt)} from ${o.farmer.farmName}`}
              actions={<><StatusBadge status={o.status} /><StatusBadge status={o.paymentStatus} text={`Payment: ${o.paymentStatus.toLowerCase()}`} /></>}
            />

            <Glass className="stack" as="section" aria-label="Order progress">
              <OrderTimeline status={o.status} />
              {o.status === 'CANCELLED' && <Banner kind="error">This order was cancelled{o.cancelReason ? `: ${o.cancelReason}` : ''}.</Banner>}
              {unpaid && (
                <Banner kind="warn">
                  <div className="row between"><span>{o.paymentStatus === 'FAILED' ? 'Your payment failed.' : 'Payment is pending.'}</span><Link className="btn primary sm" to={`/pay/${o.groupId}`}>Pay now</Link></div>
                </Banner>
              )}
            </Glass>

            {o.status === 'DISPATCHED' && o.deliveryOtp && (
              <Glass className="stack" as="section" aria-label="Delivery code">
                <h3>Your delivery code</h3>
                <div className="otp glass strong" aria-label={`Delivery code ${o.deliveryOtp.split('').join(' ')}`}>{o.deliveryOtp}</div>
                <p className="small muted" style={{ margin: 0 }}>Share this code with the delivery partner <strong>only at handover</strong>. It confirms you received your order.</p>
              </Glass>
            )}

            {o.delivery && (
              <Glass className="stack" as="section" aria-label="Delivery">
                <div className="row between"><h3 style={{ margin: 0 }}>Delivery</h3><StatusBadge status={o.delivery.status} /></div>
                {o.delivery.assignedTo ? (
                  <p style={{ margin: 0 }}>Delivery partner: <strong>{o.delivery.assignedTo.name}</strong> · <a href={`tel:${o.delivery.assignedTo.phone}`}>{o.delivery.assignedTo.phone}</a></p>
                ) : (
                  <p className="muted" style={{ margin: 0 }}>Waiting for a delivery partner to accept.</p>
                )}
                {loc && (
                  <p style={{ margin: 0 }}>
                    📍 Live location: {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
                    {loc.updatedAt && <span className="muted"> · updated {timeAgo(loc.updatedAt)}</span>} · <a href={mapsPoint(loc.lat, loc.lng)} target="_blank" rel="noreferrer">Open in maps</a>
                  </p>
                )}
              </Glass>
            )}

            <div className="two-col">
              <Glass as="section" aria-label="Items">
                <h3>Items</h3>
                {o.items.map((i) => (
                  <div className="line" key={i.productId}>
                    <span className="grow">{i.quantity} × {i.name} <span className="small muted">({money(i.unitPrice)} / {i.unit})</span></span>
                    <strong>{money(i.unitPrice * i.quantity)}</strong>
                  </div>
                ))}
                <div className="total-row" style={{ marginTop: '0.5rem' }}><span>Subtotal</span><span>{money(o.subtotal)}</span></div>
                <div className="total-row"><span>Delivery fee</span><span>{money(o.deliveryFee)}</span></div>
                <div className="total-row grand"><span>Total</span><span>{money(o.total)}</span></div>
                {o.refunded > 0 && <Banner kind="info">Refund of {money(o.refunded)} has been started.</Banner>}
              </Glass>
              <Glass className="stack" as="section" aria-label="Order information">
                <h3>Details</h3>
                <dl className="kv">
                  <dt>Farm</dt><dd>{o.farmer.farmName}</dd>
                  <dt>Pickup from</dt><dd>{o.farmer.farmLocation}</dd>
                  <dt>Deliver to</dt><dd>{o.deliveryAddress}</dd>
                </dl>
                {(o.status === 'PLACED' || o.status === 'ACCEPTED') ? (
                  <>
                    <Button variant="danger" onClick={() => setCancelling(true)}>Cancel order</Button>
                    <p className="small muted" style={{ margin: 0 }}>You can cancel until the farmer packs your order. {o.paymentStatus === 'PAID' ? 'You will get a full refund.' : ''}</p>
                  </>
                ) : o.status === 'PACKED' || o.status === 'DISPATCHED' ? (
                  <p className="small muted" style={{ margin: 0 }}>Packed orders can no longer be cancelled. Having a problem?</p>
                ) : null}
                <Link className="btn sm" to={`/support?orderId=${o.id}`}>Report a problem</Link>
              </Glass>
            </div>

            {o.status === 'DELIVERED' && (
              <Glass as="section" aria-label="Rate your products">
                <h3>Rate your products</h3>
                {o.items.filter((i) => o.ratedProductIds.includes(i.productId)).map((i) => (
                  <div className="line" key={i.productId}><span className="grow">{i.name}</span><span className="badge ok">Rated</span></div>
                ))}
                {toRate.map((i) => <RateItem key={i.productId} order={o} item={i} onDone={data.reload} />)}
              </Glass>
            )}
          </div>
        )}
      </Async>
      {cancelling && (
        <ConfirmDialog
          title="Cancel this order?"
          message="This can't be undone. Any payment you made will be refunded."
          confirmText="Yes, cancel order"
          danger
          reasonLabel="Reason (optional)"
          reasonRequired={false}
          onConfirm={cancel}
          onClose={() => setCancelling(false)}
        />
      )}
    </>
  );
}
