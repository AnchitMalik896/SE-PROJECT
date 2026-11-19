import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, post } from '../../api';
import { dateTime, mapsDirections, mapsPoint, money } from '../../format';
import { errMsg, fieldErrs, useLoad } from '../../hooks';
import type { Delivery } from '../../types';
import { Async, Banner, Button, ConfirmDialog, Field, Glass, PageHead, StatusBadge, useToast } from '../../ui';

const SEND_EVERY_MS = 10_000;

/** US-29: shares live location only while PICKED_UP / ON_THE_WAY. Stops on toggle-off, unmount and delivery end. */
function LocationSharing({ id, active }: { id: string; active: boolean }) {
  const [on, setOn] = useState(true);
  const [lastSent, setLastSent] = useState<Date | null>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lastPost = useRef(0);

  const send = async (lat: number, lng: number) => {
    await post(`/delivery/${id}/location`, { lat, lng });
    lastPost.current = Date.now();
    setLastSent(new Date());
  };

  useEffect(() => {
    if (!active || !on) return;
    if (!('geolocation' in navigator)) {
      setGeoErr('This device cannot share its location. Use the manual button below.');
      return;
    }
    setGeoErr(null);
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        if (Date.now() - lastPost.current < SEND_EVERY_MS) return;
        lastPost.current = Date.now(); // claim the slot so overlapping fixes don't double-send
        send(pos.coords.latitude, pos.coords.longitude).catch((e) => setGeoErr(errMsg(e)));
      },
      (err) => setGeoErr(err.code === err.PERMISSION_DENIED ? 'Location permission was denied. Allow it in your browser settings, or send it manually below.' : 'Could not get your location right now. You can send it manually below.'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, on, id]);

  const manual = () => {
    if (!('geolocation' in navigator)) return setGeoErr('This device cannot share its location.');
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await send(pos.coords.latitude, pos.coords.longitude);
          setGeoErr(null);
        } catch (e) {
          setGeoErr(errMsg(e));
        } finally {
          setBusy(false);
        }
      },
      () => {
        setGeoErr('Could not read your location. Check permissions and try again.');
        setBusy(false);
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  if (!active) return <Banner kind="info">Location sharing is off. It only runs while you are delivering and stops when the order is delivered.</Banner>;
  return (
    <Glass className="stack">
      <div className="row between">
        <h3 style={{ margin: 0 }}>Live location</h3>
        <label className="checkbox">
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> Share my live location
        </label>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {on ? <>🟢 Sharing with the customer about every 10 seconds. {lastSent ? `Last sent ${lastSent.toLocaleTimeString()}.` : 'Waiting for the first GPS fix…'}</> : '⚪ Not sharing. The customer cannot see where you are.'}
      </p>
      {geoErr && <Banner kind="warn">{geoErr}</Banner>}
      <div><Button size="sm" busy={busy} onClick={manual}>Send my location now</Button></div>
    </Glass>
  );
}

export function DeliveryDetail() {
  const { id = '' } = useParams();
  const toast = useToast();
  const nav = useNavigate();
  const q = useLoad(() => get<{ delivery: Delivery }>(`/delivery/${id}`), [id], 15_000);
  const d = q.data?.delivery;
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'fail' | 'release' | null>(null);
  const [otp, setOtp] = useState('');
  const [otpErr, setOtpErr] = useState<string | null>(null);

  const setStatus = async (status: 'PICKED_UP' | 'ON_THE_WAY') => {
    setBusy(true);
    try {
      await post(`/delivery/${id}/status`, { status });
      toast.ok(status === 'PICKED_UP' ? 'Marked as picked up. The customer now has their OTP.' : 'Marked as on the way');
      await q.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(otp)) return setOtpErr('Enter the 4-digit code from the customer');
    setBusy(true);
    setOtpErr(null);
    try {
      await post(`/delivery/${id}/confirm`, { otp });
      toast.ok('Delivery confirmed');
      setOtp('');
      await q.reload();
    } catch (err) {
      setOtpErr(fieldErrs(err).otp ? `${errMsg(err)}` : errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const dialogCall = (path: string, body: Record<string, unknown>, done: string, after?: () => void) => async (reason: string) => {
    try {
      await post(path, { ...body, reason });
    } catch (e) {
      throw new Error(errMsg(e));
    }
    toast.ok(done);
    if (after) after();
    else await q.reload();
  };

  return (
    <>
      <PageHead title={d ? `Delivery · Order #${d.orderRef}` : 'Delivery'} subtitle={<Link to="/delivery/mine">← My deliveries</Link>} actions={d && <StatusBadge status={d.status} />} />
      <Async loading={q.loading} error={q.error} onRetry={q.reload}>
        {d && (
          <div className="stack">
            {d.status === 'DELIVERED' && (
              <Glass className="done-state"><div className="big" aria-hidden>✅</div><h2>Delivered ✓</h2><p className="muted">Completed {dateTime(d.completedAt)}. Location sharing has stopped and the farmer's payout was released.</p></Glass>
            )}
            {d.status === 'FAILED' && <Banner kind="warn">This delivery was not completed{d.failureReason ? `: ${d.failureReason}` : ''}. An administrator has been notified.</Banner>}

            <div className="grid cols-2">
              <Glass className="stack">
                <h3 style={{ margin: 0 }}>1 · Pickup — {d.farmName}</h3>
                <div>{d.pickupAddress}</div>
                {d.pickupPhone && <div>📞 <a href={`tel:${d.pickupPhone}`}>{d.pickupPhone}</a></div>}
                <a className="btn sm" href={mapsDirections('', d.pickupAddress)} target="_blank" rel="noreferrer">Navigate to pickup ↗</a>
              </Glass>
              <Glass className="stack">
                <h3 style={{ margin: 0 }}>2 · Drop-off</h3>
                <div>{d.dropAddress ?? '—'}</div>
                {d.dropPhone && <div>📞 <a href={`tel:${d.dropPhone}`}>{d.dropPhone}</a></div>}
                {d.dropAddress && <a className="btn sm" href={mapsDirections('', d.dropAddress)} target="_blank" rel="noreferrer">Navigate to drop-off ↗</a>}
              </Glass>
            </div>

            {d.dropAddress && (
              <Glass className="row between">
                <span className="small muted">Route: go to the pickup first, then the destination.</span>
                <a className="btn sm primary" href={mapsDirections(d.pickupAddress, d.dropAddress)} target="_blank" rel="noreferrer">Open full route in Maps ↗</a>
              </Glass>
            )}

            <Glass className="stack">
              <h3 style={{ margin: 0 }}>Order</h3>
              <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>{(d.items ?? []).map((i) => <li key={i}>{i}</li>)}</ul>
              <div>Order value <strong>{money(d.orderTotal)}</strong> — <strong>{d.paymentNote}</strong></div>
              {d.lat != null && d.lng != null && <a className="small" href={mapsPoint(d.lat, d.lng)} target="_blank" rel="noreferrer">Last shared position ↗</a>}
            </Glass>

            {d.status === 'ASSIGNED' && (
              <Glass className="stack">
                <h3 style={{ margin: 0 }}>Next step</h3>
                <div className="row">
                  <Button variant="primary" busy={busy} onClick={() => setStatus('PICKED_UP')}>Mark picked up</Button>
                  <Button variant="danger" onClick={() => setDialog('release')}>Give up this delivery</Button>
                </div>
                <span className="small muted">You can give a delivery back only before you pick it up.</span>
              </Glass>
            )}

            {(d.status === 'PICKED_UP' || d.status === 'ON_THE_WAY') && (
              <>
                <Glass className="stack">
                  <h3 style={{ margin: 0 }}>Delivery progress</h3>
                  <div className="row">
                    {d.status === 'PICKED_UP' && <Button variant="primary" busy={busy} onClick={() => setStatus('ON_THE_WAY')}>On the way</Button>}
                    <Button variant="danger" onClick={() => setDialog('fail')}>Could not deliver</Button>
                  </div>
                </Glass>
                <LocationSharing id={d.id} active />
                <Glass>
                  <form className="stack" onSubmit={confirm} noValidate>
                    <h3 style={{ margin: 0 }}>Confirm delivery</h3>
                    <p className="small muted" style={{ margin: 0 }}>Ask the customer for the 4-digit code shown on their order page. Payment is released to the farmer once it matches.</p>
                    <Field className="" label="Customer's OTP" inputMode="numeric" autoComplete="one-time-code" maxLength={4} pattern="\d{4}" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} error={otpErr ?? undefined} />
                    <div><Button type="submit" variant="primary" busy={busy}>Confirm delivered</Button></div>
                  </form>
                </Glass>
              </>
            )}
            {d.status !== 'PICKED_UP' && d.status !== 'ON_THE_WAY' && <LocationSharing id={d.id} active={false} />}
          </div>
        )}
      </Async>

      {dialog === 'fail' && <ConfirmDialog title="Could not deliver?" message="An administrator will be notified and decide what happens next." reasonLabel="What went wrong?" confirmText="Report failed delivery" danger onClose={() => setDialog(null)} onConfirm={dialogCall(`/delivery/${id}/status`, { status: 'FAILED' }, 'Reported to an administrator')} />}
      {dialog === 'release' && <ConfirmDialog title="Give up this delivery?" message="It goes back to the pool for other delivery partners." reasonLabel="Reason" confirmText="Give up" danger onClose={() => setDialog(null)} onConfirm={dialogCall(`/delivery/${id}/release`, {}, 'Delivery released', () => nav('/delivery'))} />}
    </>
  );
}
