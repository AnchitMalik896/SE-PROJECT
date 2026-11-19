import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../../api';
import { dateTime } from '../../format';
import { useLoad } from '../../hooks';
import type { Delivery } from '../../types';
import { Async, Chips, Empty, Glass, PageHead, StatusBadge } from '../../ui';

export function Mine() {
  const [state, setState] = useState<'active' | 'completed'>('active');
  const list = useLoad(() => get<{ items: Delivery[] }>('/delivery/mine', { state }), [state], 15_000);
  return (
    <>
      <PageHead title="My deliveries" />
      <div style={{ marginBottom: '1rem' }}>
        <Chips value={state} onChange={setState} options={[{ value: 'active', label: 'Active' }, { value: 'completed', label: 'Completed' }]} />
      </div>
      <Async loading={list.loading} error={list.error} onRetry={list.reload}>
        {list.data && list.data.items.length === 0 ? (
          <Glass><Empty icon="🛵" title={state === 'active' ? 'No active deliveries' : 'Nothing completed yet'}>
            {state === 'active' && <Link to="/delivery">Browse available deliveries →</Link>}
          </Empty></Glass>
        ) : (
          <div className="grid cols-2">
            {list.data?.items.map((d) => (
              <Glass key={d.id} className="d-card" hover>
                <div className="row between">
                  <h3 style={{ margin: 0 }}>Order #{d.orderRef}</h3>
                  <StatusBadge status={d.status} />
                </div>
                <div className="small muted">{d.farmName} · {d.itemCount} item{d.itemCount === 1 ? '' : 's'}</div>
                <div className="d-route">
                  <span><span className="muted">From </span>{d.pickupAddress}</span>
                  <span><span className="muted">To </span>{d.dropAddress ?? '—'}</span>
                </div>
                {d.status === 'FAILED' && d.failureReason && <div className="banner warn">Not delivered: {d.failureReason}</div>}
                {d.completedAt && <div className="small muted">Completed {dateTime(d.completedAt)}</div>}
                <Link className="btn sm" to={`/delivery/${d.id}`}>Open details</Link>
              </Glass>
            ))}
          </div>
        )}
      </Async>
    </>
  );
}
