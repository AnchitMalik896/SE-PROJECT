import { useEffect, useState } from 'react';
import { get, post, put } from '../../api';
import { dateTime, fromPaise, money, toPaise } from '../../format';
import { errMsg, useLoad } from '../../hooks';
import { Async, Button, Empty, Field, Glass, PageHead, Stars, StatusBadge, useToast } from '../../ui';

interface RatingRow {
  id: string;
  stars: number;
  comment: string | null;
  hidden: boolean;
  consumerName: string;
  farmerName: string;
  productName: string;
  createdAt: string;
}

function DeliveryFee() {
  const toast = useToast();
  const L = useLoad(() => get<{ deliveryFee: number }>('/admin/settings'), []);
  const [val, setVal] = useState('');
  const [err, setErr] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (L.data) setVal(fromPaise(L.data.deliveryFee)); }, [L.data]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const paise = toPaise(val);
    if (paise === null || val.trim() === '') return setErr('Enter an amount in rupees, e.g. 40 or 49.50');
    if (paise > 100_000) return setErr('The fee cannot be more than ₹1,000');
    setErr(undefined);
    setBusy(true);
    try {
      await put('/admin/settings', { deliveryFee: paise });
      toast.ok(`Delivery fee set to ${money(paise)}`);
      await L.reload();
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Glass>
      <h2>Delivery fee</h2>
      <p className="muted">A flat fee charged once per farmer's order at checkout. Existing orders keep the fee they were placed with.</p>
      <Async loading={L.loading && !L.data} error={L.error} onRetry={L.reload}>
        <form className="filters" onSubmit={save}>
          <Field label="Fee (₹)" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} error={err} hint={L.data ? `Currently ${money(L.data.deliveryFee)}` : undefined} />
          <Button variant="primary" type="submit" busy={busy}>Save fee</Button>
        </form>
      </Async>
    </Glass>
  );
}

function Ratings() {
  const toast = useToast();
  const L = useLoad(() => get<{ items: RatingRow[] }>('/admin/ratings'), []);
  const [busy, setBusy] = useState<string | null>(null);
  const toggle = async (r: RatingRow) => {
    setBusy(r.id);
    try {
      await post(`/admin/ratings/${r.id}/hide`, { hidden: !r.hidden });
      toast.ok(r.hidden ? 'Review is visible again' : 'Review hidden');
      await L.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Glass>
      <h2>Ratings moderation</h2>
      <p className="muted">Hidden reviews no longer show on product pages or count toward a farmer's average.</p>
      <Async loading={L.loading && !L.data} error={L.error} onRetry={L.reload}>
        {L.data && (L.data.items.length === 0 ? <Empty icon="⭐" title="No ratings yet" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Rating</th><th>Review</th><th>Product / farmer</th><th>By</th><th>Date</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {L.data.items.map((r) => (
                  <tr key={r.id} style={r.hidden ? { opacity: 0.65 } : undefined}>
                    <td><Stars value={r.stars} /></td>
                    <td className="wrap-text">{r.comment || <span className="muted">No comment</span>}{r.hidden && <> <StatusBadge status="BLOCKED" text="Hidden" /></>}</td>
                    <td>{r.productName}<div className="small muted">{r.farmerName}</div></td>
                    <td>{r.consumerName}</td>
                    <td className="small">{dateTime(r.createdAt)}</td>
                    <td><Button size="sm" busy={busy === r.id} onClick={() => toggle(r)} aria-label={`${r.hidden ? 'Restore' : 'Hide'} review of ${r.productName}`}>{r.hidden ? 'Restore' : 'Hide'}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Async>
    </Glass>
  );
}

export default function Settings() {
  return (
    <div className="stack">
      <PageHead title="Settings" subtitle="Platform fees and review moderation" />
      <DeliveryFee />
      <Ratings />
    </div>
  );
}
