import { useState } from 'react';
import { del, get, patch, post } from '../../api';
import { dateOnly } from '../../format';
import { errMsg, fieldErrs, useDebounced, useLoad } from '../../hooks';
import type { AdminUser, Paged } from '../../types';
import { Async, Banner, Button, Chips, ConfirmDialog, Empty, Field, Modal, Pagination, StatusBadge, useToast } from '../../ui';

export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  return (
    <>
      <Field label="From" type="date" value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)} />
      <Field label="To" type="date" value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)} />
    </>
  );
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * 86_400_000));

export function EditUserModal({ user, onClose, onSaved }: { user: AdminUser; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: user.name,
    email: user.email,
    phone: user.phone,
    address: user.address ?? '',
    farmName: user.farmerProfile?.farmName ?? '',
    farmLocation: user.farmerProfile?.farmLocation ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    setErr(null);
    setFields({});
    const body: Record<string, string> = { name: f.name, email: f.email, phone: f.phone };
    if (user.role === 'CONSUMER' && f.address.trim()) body.address = f.address;
    if (user.role === 'FARMER') {
      body.farmName = f.farmName;
      body.farmLocation = f.farmLocation;
    }
    try {
      await patch(`/admin/users/${user.id}`, body);
      toast.ok('Details saved');
      onSaved();
      onClose();
    } catch (e) {
      setErr(errMsg(e));
      setFields(fieldErrs(e));
      setBusy(false);
    }
  };

  return (
    <Modal title={`Edit ${user.name}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save changes</Button></>}>
      {err && <Banner kind="error">{err}</Banner>}
      <Field label="Name" value={f.name} onChange={set('name')} error={fields.name} />
      <Field label="Email" type="email" value={f.email} onChange={set('email')} error={fields.email} />
      <Field label="Phone" value={f.phone} onChange={set('phone')} error={fields.phone} />
      {user.role === 'CONSUMER' && <Field label="Delivery address" value={f.address} onChange={set('address')} error={fields.address} />}
      {user.role === 'FARMER' && (
        <>
          <Field label="Farm name" value={f.farmName} onChange={set('farmName')} error={fields.farmName} />
          <Field label="Farm location" value={f.farmLocation} onChange={set('farmLocation')} error={fields.farmLocation} />
        </>
      )}
    </Modal>
  );
}

type Dlg = { kind: 'edit' | 'block' | 'remove'; user: AdminUser } | null;

export function UserTable({ users, onChanged }: { users: AdminUser[]; onChanged: () => void }) {
  const toast = useToast();
  const [dlg, setDlg] = useState<Dlg>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const unblock = async (u: AdminUser) => {
    setBusyId(u.id);
    try {
      await post(`/admin/users/${u.id}/unblock`);
      toast.ok(`${u.name} was unblocked`);
      onChanged();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Name</th><th>Contact</th><th>Details</th><th>Status</th><th>Joined</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.name}</strong></td>
                <td>{u.email}<div className="small muted">{u.phone}</div></td>
                <td className="wrap-text small">
                  {u.role === 'FARMER' ? <>{u.farmerProfile?.farmName}<div className="muted">{u.farmerProfile?.farmLocation}</div></> : u.address ?? <span className="muted">—</span>}
                </td>
                <td>
                  <StatusBadge status={u.status} />
                  {u.status === 'BLOCKED' && u.blockReason && <div className="small muted wrap-text">Reason: {u.blockReason}</div>}
                </td>
                <td className="small">{dateOnly(u.createdAt)}</td>
                <td>
                  <div className="cell-actions">
                    <Button size="sm" onClick={() => setDlg({ kind: 'edit', user: u })} aria-label={`Edit ${u.name}`}>Edit</Button>
                    {u.status === 'BLOCKED' ? (
                      <Button size="sm" busy={busyId === u.id} onClick={() => unblock(u)} aria-label={`Unblock ${u.name}`}>Unblock</Button>
                    ) : (
                      <Button size="sm" variant="danger" onClick={() => setDlg({ kind: 'block', user: u })} aria-label={`Block ${u.name}`}>Block</Button>
                    )}
                    {u.role === 'DELIVERY' && <Button size="sm" variant="danger" onClick={() => setDlg({ kind: 'remove', user: u })} aria-label={`Remove ${u.name}`}>Remove</Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dlg?.kind === 'edit' && <EditUserModal user={dlg.user} onClose={() => setDlg(null)} onSaved={onChanged} />}
      {dlg?.kind === 'block' && (
        <ConfirmDialog
          title={`Block ${dlg.user.name}?`}
          message="They are signed out immediately and cannot log in until unblocked. The reason is recorded."
          confirmText="Block account"
          danger
          reasonLabel="Reason for blocking"
          onClose={() => setDlg(null)}
          onConfirm={async (reason) => {
            await post(`/admin/users/${dlg.user.id}/block`, { reason });
            toast.ok(`${dlg.user.name} was blocked`);
            onChanged();
          }}
        />
      )}
      {dlg?.kind === 'remove' && (
        <ConfirmDialog
          title={`Remove ${dlg.user.name}?`}
          message="If this person has delivery history the account is deactivated instead of deleted, so past orders stay intact."
          confirmText="Remove"
          danger
          onClose={() => setDlg(null)}
          onConfirm={async () => {
            const r = await del<{ message: string }>(`/admin/delivery/${dlg.user.id}`);
            toast.ok(r.message);
            onChanged();
          }}
        />
      )}
    </>
  );
}

export function UserDirectory({ role, refreshKey = 0, emptyText }: { role: 'FARMER' | 'CONSUMER' | 'DELIVERY'; refreshKey?: number; emptyText: string }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const L = useLoad(() => get<Paged<AdminUser>>('/admin/users', { role, status, search: q, page }), [role, status, q, page, refreshKey]);

  return (
    <div className="stack">
      <div className="filters">
        <Field className="grow" label="Search" type="search" placeholder="Name, email, phone…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <Chips value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: '', label: 'All' }, { value: 'ACTIVE', label: 'Active' }, { value: 'BLOCKED', label: 'Blocked' }]} />
      </div>
      <Async loading={L.loading && !L.data} error={L.error} onRetry={L.reload}>
        {L.data && (L.data.items.length === 0 ? <Empty icon="🔍" title="Nobody found">{emptyText}</Empty> : (
          <>
            <UserTable users={L.data.items} onChanged={L.reload} />
            <Pagination data={L.data} onPage={setPage} />
          </>
        ))}
      </Async>
    </div>
  );
}
