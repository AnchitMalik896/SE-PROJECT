import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, get, post } from '../../api';
import { money } from '../../format';
import { errMsg, useLoad } from '../../hooks';
import type { Delivery } from '../../types';
import { Async, Button, Empty, Glass, PageHead, useToast } from '../../ui';

export function Available() {
  const toast = useToast();
  const nav = useNavigate();
  const pool = useLoad(() => get<{ items: Delivery[] }>('/delivery/available'), [], 15_000);
  const mine = useLoad(() => get<{ items: Delivery[] }>('/delivery/mine', { state: 'active' }), [], 15_000);
  const [busy, setBusy] = useState<string | null>(null);

  const accept = async (d: Delivery) => {
    setBusy(d.id);
    try {
      await post(`/delivery/${d.id}/accept`);
      toast.ok('Delivery accepted');
      nav(`/delivery/${d.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) toast.error('Someone else already took this delivery');
      else toast.error(errMsg(e));
      await pool.reload();
      setBusy(null);
    }
  };
  const decline = async (d: Delivery) => {
    setBusy(d.id);
    try {
      await post(`/delivery/${d.id}/decline`);
      toast.ok('Declined — it stays available for others');
      await pool.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const activeCount = mine.data?.items.length ?? 0;
  return (
    <>
      <PageHead title="Available deliveries" subtitle="Packed orders waiting for a delivery partner. Refreshes every 15 seconds." />
      {activeCount > 0 && (
        <Link to="/delivery/mine" className="banner info" style={{ display: 'block', marginBottom: '1rem', textDecoration: 'none' }}>
          🛵 You have {activeCount} active deliver{activeCount === 1 ? 'y' : 'ies'} — open them →
        </Link>
      )}
      <Async loading={pool.loading} error={pool.error} onRetry={pool.reload}>
        {pool.data && pool.data.items.length === 0 ? (
          <Glass><Empty icon="📍" title="No deliveries available right now">New packed orders will appear here automatically.</Empty></Glass>
        ) : (
          <div className="grid cols-2">
            {pool.data?.items.map((d) => (
              <Glass key={d.id} className="d-card">
                <div className="row between">
                  <h3 style={{ margin: 0 }}>{d.farmName}</h3>
                  <span className="badge">Order #{d.orderRef}</span>
                </div>
                <div className="d-route">
                  <span className="small muted">Pickup</span>
                  <span className="pin">{d.pickupAddress}</span>
                  <span className="small muted" style={{ marginTop: '0.4rem' }}>Drop-off</span>
                  <span className="small">Hidden until you accept (the customer's address is private).</span>
                </div>
                <div className="small muted">{d.itemCount} item{d.itemCount === 1 ? '' : 's'} · order value {money(d.orderTotal)} · {d.paymentNote}</div>
                <div className="row">
                  <Button variant="primary" busy={busy === d.id} onClick={() => accept(d)}>Accept</Button>
                  <Button disabled={busy === d.id} onClick={() => decline(d)}>Decline</Button>
                </div>
              </Glass>
            ))}
          </div>
        )}
      </Async>
    </>
  );
}
