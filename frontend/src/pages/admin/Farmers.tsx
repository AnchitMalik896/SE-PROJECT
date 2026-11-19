import { useState } from 'react';
import { get, post } from '../../api';
import { dateOnly } from '../../format';
import { errMsg, useLoad } from '../../hooks';
import type { AdminUser } from '../../types';
import { Async, Button, ConfirmDialog, Empty, Glass, PageHead, useToast } from '../../ui';
import { UserDirectory } from './common';

export default function Farmers() {
  const toast = useToast();
  const pending = useLoad(() => get<{ items: AdminUser[] }>('/admin/farmers/pending'), []);
  const [rejecting, setRejecting] = useState<AdminUser | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const approve = async (f: AdminUser) => {
    setBusy(f.id);
    try {
      await post(`/admin/farmers/${f.id}/approve`);
      toast.ok(`${f.farmerProfile?.farmName ?? f.name} approved`);
      await pending.reload();
      setTick((t) => t + 1);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack">
      <PageHead title="Farmers" subtitle="Verify new sellers and manage existing farmer accounts" />
      <Glass>
        <h2>Verification queue</h2>
        <Async loading={pending.loading && !pending.data} error={pending.error} onRetry={pending.reload}>
          {pending.data && (pending.data.items.length === 0 ? <Empty icon="✅" title="No farmers waiting">New registrations will appear here.</Empty> : (
            <div className="grid cols-2">
              {pending.data.items.map((f) => (
                <article key={f.id} className="detail-box stack" aria-label={`Verification request from ${f.name}`}>
                  <div>
                    <h3 style={{ margin: 0 }}>{f.farmerProfile?.farmName}</h3>
                    <div className="small muted">{f.farmerProfile?.farmLocation}</div>
                  </div>
                  {f.farmerProfile?.bio && <p className="small">{f.farmerProfile.bio}</p>}
                  <dl className="kv small" style={{ margin: 0 }}>
                    <dt>Owner</dt><dd>{f.name}</dd>
                    <dt>Email</dt><dd>{f.email}</dd>
                    <dt>Phone</dt><dd>{f.phone}</dd>
                    <dt>Registered</dt><dd>{dateOnly(f.createdAt)}</dd>
                  </dl>
                  <div className="row">
                    <Button variant="primary" size="sm" busy={busy === f.id} onClick={() => approve(f)}>Approve</Button>
                    <Button variant="danger" size="sm" onClick={() => setRejecting(f)}>Reject</Button>
                  </div>
                </article>
              ))}
            </div>
          ))}
        </Async>
      </Glass>

      <Glass>
        <h2>All farmers</h2>
        <UserDirectory role="FARMER" refreshKey={tick} emptyText="Try a different search or filter." />
      </Glass>

      {rejecting && (
        <ConfirmDialog
          title={`Reject ${rejecting.farmerProfile?.farmName ?? rejecting.name}?`}
          message="The farmer is told the reason and cannot log in."
          confirmText="Reject"
          danger
          reasonLabel="Reason (shown to the farmer)"
          onClose={() => setRejecting(null)}
          onConfirm={async (reason) => {
            await post(`/admin/farmers/${rejecting.id}/reject`, { reason });
            toast.ok('Registration rejected');
            await pending.reload();
            setTick((t) => t + 1);
          }}
        />
      )}
    </div>
  );
}
