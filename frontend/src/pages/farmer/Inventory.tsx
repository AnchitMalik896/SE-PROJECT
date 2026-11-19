import { useState } from 'react';
import { get, patch } from '../../api';
import { errMsg, useLoad } from '../../hooks';
import type { FarmerProduct } from '../../types';
import { Async, Button, Empty, Glass, PageHead, useToast } from '../../ui';

export function Inventory() {
  const toast = useToast();
  const list = useLoad(() => get<{ items: FarmerProduct[] }>('/farmer/products'));
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const value = (p: FarmerProduct) => draft[p.id] ?? String(p.stock);
  const dirty = (p: FarmerProduct) => draft[p.id] !== undefined && draft[p.id] !== String(p.stock);
  const bump = (p: FarmerProduct, d: number) => setDraft((x) => ({ ...x, [p.id]: String(Math.max(0, (Number(value(p)) || 0) + d)) }));

  const save = async (p: FarmerProduct) => {
    const n = Number(value(p));
    if (!Number.isInteger(n) || n < 0) return toast.error('Stock must be a whole number, 0 or more');
    setBusy(p.id);
    try {
      await patch(`/farmer/products/${p.id}/stock`, { stock: n });
      setDraft(({ [p.id]: _gone, ...rest }) => rest);
      toast.ok(`${p.name}: stock set to ${n}`);
      await list.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHead title="Inventory" subtitle="Keep stock accurate so customers can't order more than you have. Stock drops automatically when an order is placed." />
      <Async loading={list.loading} error={list.error} onRetry={list.reload}>
        {list.data && list.data.items.length === 0 ? (
          <Glass><Empty icon="📋" title="Nothing to track yet">Add products first.</Empty></Glass>
        ) : (
          <Glass>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Product</th><th>Status</th><th>Stock</th><th /></tr></thead>
                <tbody>
                  {list.data?.items.map((p) => (
                    <tr key={p.id} className={p.stock <= 5 ? 'low-row' : ''}>
                      <td><strong>{p.name}</strong><div className="small muted">{p.unit}</div></td>
                      <td>{p.stock === 0 ? <span className="badge danger">Out of stock</span> : p.stock <= 5 ? <span className="badge warn">Low</span> : <span className="badge ok">In stock</span>}</td>
                      <td>
                        <div className="qty">
                          <button type="button" aria-label={`Decrease ${p.name} stock`} onClick={() => bump(p, -1)} disabled={Number(value(p)) <= 0}>−</button>
                          <input className="input stock-input" inputMode="numeric" aria-label={`${p.name} stock`} value={value(p)} onChange={(e) => setDraft((x) => ({ ...x, [p.id]: e.target.value }))} />
                          <button type="button" aria-label={`Increase ${p.name} stock`} onClick={() => bump(p, 1)}>+</button>
                        </div>
                      </td>
                      <td className="right"><Button size="sm" variant="primary" disabled={!dirty(p)} busy={busy === p.id} onClick={() => save(p)}>Save</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Glass>
        )}
      </Async>
    </>
  );
}
