import { useState } from 'react';
import { get, post } from '../../api';
import { dateTime, label } from '../../format';
import { useLoad } from '../../hooks';
import type { Complaint } from '../../types';
import { Async, Button, Chips, ConfirmDialog, Empty, Glass, PageHead, StatusBadge, useToast } from '../../ui';

export default function Complaints() {
  const toast = useToast();
  const [status, setStatus] = useState('OPEN');
  const L = useLoad(() => get<{ items: Complaint[] }>('/admin/complaints', { status }), [status]);
  const [target, setTarget] = useState<Complaint | null>(null);

  return (
    <div className="stack">
      <PageHead title="Complaints & disputes" subtitle="Review problems reported between users" />
      <Chips value={status} onChange={setStatus} options={[{ value: 'OPEN', label: 'Open' }, { value: 'RESOLVED', label: 'Resolved' }, { value: '', label: 'All' }]} />
      <Async loading={L.loading && !L.data} error={L.error} onRetry={L.reload}>
        {L.data && (L.data.items.length === 0 ? <Glass><Empty icon="⚖️" title="No complaints here">{status === 'OPEN' ? 'Nothing is waiting for you.' : 'Nothing to show.'}</Empty></Glass> : (
          <div className="stack">
            {L.data.items.map((c) => (
              <Glass key={c.id} as="article">
                <div className="row between">
                  <h3 style={{ margin: 0 }}>{c.subject}</h3>
                  <StatusBadge status={c.status} />
                </div>
                <p style={{ marginTop: '0.6rem' }} className="wrap-text">{c.description}</p>
                <dl className="kv small">
                  <dt>Filed by</dt><dd>{c.filedBy ? `${c.filedBy.name} (${label(c.filedBy.role)})` : '—'}</dd>
                  <dt>Against</dt><dd>{c.against ? `${c.against.name} (${label(c.against.role)})` : '—'}</dd>
                  <dt>Order</dt><dd>{c.orderRef ? `#${c.orderRef}` : '—'}</dd>
                  <dt>Filed</dt><dd>{dateTime(c.createdAt)}</dd>
                </dl>
                {c.status === 'RESOLVED' ? (
                  <div className="banner ok"><strong>Resolution:</strong> {c.resolutionNotes}</div>
                ) : (
                  <Button variant="primary" size="sm" onClick={() => setTarget(c)}>Resolve</Button>
                )}
              </Glass>
            ))}
          </div>
        ))}
      </Async>
      {target && (
        <ConfirmDialog
          title="Resolve complaint"
          message={`Both parties are notified of the outcome of “${target.subject}”.`}
          confirmText="Mark resolved"
          reasonLabel="Resolution notes"
          onClose={() => setTarget(null)}
          onConfirm={async (notes) => {
            if (notes.length < 5) throw new Error('Please record how this was resolved (at least 5 characters)');
            await post(`/admin/complaints/${target.id}/resolve`, { notes });
            toast.ok('Complaint resolved');
            await L.reload();
          }}
        />
      )}
    </div>
  );
}
