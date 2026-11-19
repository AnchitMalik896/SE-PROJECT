import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, patch, post } from '../../api';
import { useAuth } from '../../auth';
import { emitNotificationsChanged } from '../../events';
import { dateTime, timeAgo } from '../../format';
import { errMsg, fieldErrs, useLoad } from '../../hooks';
import type { Complaint, Notification, Order, Paged, User } from '../../types';
import { Async, Banner, Button, Empty, Field, Glass, PageHead, Select, StatusBadge, TextArea, useToast } from '../../ui';

// ---------------------------------------------------------------- notifications (US-23)
const ICON: Record<string, string> = { ORDER: '📦', PAYMENT: '💳', DELIVERY: '🛵', VERIFICATION: '✅', COMPLAINT: '⚖️', PRODUCT: '🏷️' };

export function NotificationsPage() {
  const list = useLoad(() => get<{ items: Notification[]; unread: number }>('/notifications'), [], 20_000);
  const toast = useToast();

  async function markAll() {
    try {
      await post('/notifications/read', {});
      await list.reload();
      emitNotificationsChanged();
    } catch (e) {
      toast.error(errMsg(e));
    }
  }
  async function markOne(n: Notification) {
    if (n.read) return;
    await post('/notifications/read', { ids: [n.id] }).catch(() => {});
    await list.reload();
    emitNotificationsChanged();
  }

  const d = list.data;
  return (
    <div className="stack">
      <PageHead title="Notifications" subtitle={d ? `${d.unread} unread` : undefined} actions={d && d.unread > 0 ? <Button size="sm" onClick={markAll}>Mark all as read</Button> : undefined} />
      <Async loading={list.loading && !d} error={list.error} onRetry={list.reload}>
        {d && d.items.length === 0 ? (
          <Glass><Empty icon="🔔" title="You're all caught up">Order and payment updates will show up here.</Empty></Glass>
        ) : (
          <div className="stack" style={{ gap: '0.6rem' }}>
            {d?.items.map((n) => (
              <button key={n.id} className="glass card" onClick={() => markOne(n)} style={{ textAlign: 'left', font: 'inherit', color: 'inherit', cursor: n.read ? 'default' : 'pointer', borderLeft: n.read ? undefined : '5px solid var(--accent)' }} aria-label={`${n.read ? '' : 'Unread: '}${n.message}`}>
                <div className="row between" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                  <span><span aria-hidden>{ICON[n.type] ?? '🔔'}</span> <span style={{ fontWeight: n.read ? 500 : 700 }}>{n.message}</span></span>
                  <span className="small muted" style={{ whiteSpace: 'nowrap' }} title={dateTime(n.createdAt)}>{timeAgo(n.createdAt)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </Async>
    </div>
  );
}

// ---------------------------------------------------------------- profile (US-06)
export function ProfilePage() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const fp = user?.farmerProfile;
  const [v, setV] = useState({ name: '', phone: '', address: '', farmName: '', farmLocation: '', bio: '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) setV({ name: user.name, phone: user.phone, address: user.address ?? '', farmName: fp?.farmName ?? '', farmLocation: fp?.farmLocation ?? '', bio: fp?.bio ?? '' });
  }, [user, fp]);
  if (!user) return null;
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const body: Record<string, string> = { name: v.name, phone: v.phone };
      if (user!.role === 'CONSUMER') body.address = v.address;
      if (user!.role === 'FARMER') Object.assign(body, { farmName: v.farmName, farmLocation: v.farmLocation, bio: v.bio });
      await patch<{ user: User }>('/profile', body);
      await refresh();
      toast.ok('Profile saved');
    } catch (err) {
      setError(errMsg(err));
      setFields(fieldErrs(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <PageHead title="Your profile" subtitle={<>{user.email} · <StatusBadge status={user.status} /></>} />
      {fp && (
        <Banner kind={fp.verification === 'APPROVED' ? 'ok' : 'warn'}>
          Farm verification: {fp.verification === 'APPROVED' ? 'verified — your listings are visible to customers.' : fp.verification.toLowerCase()}
        </Banner>
      )}
      <Glass>
        <form className="stack" onSubmit={save} noValidate>
          {error && <Banner kind="error">{error}</Banner>}
          <div className="form-grid">
            <Field label="Full name" value={v.name} onChange={set('name')} error={fields.name} required />
            <Field label="Phone" type="tel" value={v.phone} onChange={set('phone')} error={fields.phone} required />
          </div>
          {user.role === 'CONSUMER' && <TextArea label="Delivery address" value={v.address} onChange={set('address')} error={fields.address} />}
          {user.role === 'FARMER' && (
            <>
              <div className="form-grid">
                <Field label="Farm name" value={v.farmName} onChange={set('farmName')} error={fields.farmName} />
                <Field label="Farm location" value={v.farmLocation} onChange={set('farmLocation')} error={fields.farmLocation} />
              </div>
              <TextArea label="About your farm" value={v.bio} onChange={set('bio')} error={fields.bio} hint="Shown on your public profile" />
            </>
          )}
          <div><Button variant="primary" type="submit" busy={busy}>Save changes</Button></div>
        </form>
      </Glass>
    </div>
  );
}

// ---------------------------------------------------------------- help & complaints (feeds admin US-38)
export function SupportPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const toast = useToast();
  const [v, setV] = useState({ subject: '', description: '', orderId: params.get('orderId') ?? '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mine = useLoad(() => get<{ items: Complaint[] }>('/complaints'), []);
  const orders = useLoad(async () => {
    if (user?.role === 'CONSUMER') return (await get<Paged<Order>>('/orders', { pageSize: 50 })).items;
    if (user?.role === 'FARMER') return (await get<Paged<Order>>('/farmer/orders', { pageSize: 50 })).items;
    return [] as Order[];
  }, [user?.role]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await post('/complaints', { subject: v.subject, description: v.description, orderId: v.orderId || undefined });
      toast.ok('Complaint sent. An administrator will review it.');
      setV({ subject: '', description: '', orderId: '' });
      await mine.reload();
    } catch (err) {
      setError(errMsg(err));
      setFields(fieldErrs(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <PageHead title="Help & complaints" subtitle="Something went wrong with an order, a payment or another user? Tell us and an administrator will step in." />
      <div className="grid cols-2">
        <Glass>
          <h2>Report a problem</h2>
          <form className="stack" onSubmit={submit} noValidate>
            {error && <Banner kind="error">{error}</Banner>}
            <Field label="Subject" value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} error={fields.subject} required />
            {(orders.data?.length ?? 0) > 0 && (
              <Select label="Related order (optional)" value={v.orderId} onChange={(e) => setV({ ...v, orderId: e.target.value })}>
                <option value="">— none —</option>
                {orders.data!.map((o) => <option key={o.id} value={o.id}>#{o.ref} · {o.items.map((i) => i.name).join(', ').slice(0, 40)}</option>)}
              </Select>
            )}
            <TextArea label="What happened?" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} error={fields.description} required />
            <div><Button variant="primary" type="submit" busy={busy}>Send to administrator</Button></div>
          </form>
        </Glass>
        <Glass>
          <h2>Your complaints</h2>
          <Async loading={mine.loading} error={mine.error} onRetry={mine.reload}>
            {mine.data && mine.data.items.length === 0 ? (
              <Empty icon="🕊️" title="Nothing reported">Hopefully it stays that way.</Empty>
            ) : (
              <div className="stack">
                {mine.data?.items.map((c) => (
                  <div key={c.id} className="glass card" style={{ background: 'var(--glass-soft)' }}>
                    <div className="row between"><strong>{c.subject}</strong><StatusBadge status={c.status} /></div>
                    <p className="small muted" style={{ margin: '0.3rem 0' }}>{c.description}</p>
                    {c.resolutionNotes && <Banner kind="ok">Resolution: {c.resolutionNotes}</Banner>}
                    <div className="small muted">{dateTime(c.createdAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </Async>
        </Glass>
      </div>
    </div>
  );
}
