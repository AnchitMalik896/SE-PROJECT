import { useState } from 'react';
import { del, get, patch, post } from '../../api';
import { money } from '../../format';
import { errMsg, fieldErrs, useDebounced, useLoad } from '../../hooks';
import type { Category, Paged } from '../../types';
import { Async, Button, Chips, ConfirmDialog, Empty, Field, Glass, PageHead, Pagination, StatusBadge, useToast } from '../../ui';

interface AdminProduct {
  id: string;
  name: string;
  price: number;
  unit: string;
  stock: number;
  takenDownReason: string | null;
  category: Category | null;
  farmer: { id: string; name: string; farmerProfile: { farmName: string } | null };
}

function Categories() {
  const toast = useToast();
  const L = useLoad(() => get<{ items: Category[] }>('/categories'), []);
  const [name, setName] = useState('');
  const [addErr, setAddErr] = useState<string | undefined>();
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [editErr, setEditErr] = useState<string | undefined>();
  const [removing, setRemoving] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setAddErr(undefined);
    try {
      await post('/admin/categories', { name });
      setName('');
      toast.ok('Category added');
      await L.reload();
    } catch (er) {
      setAddErr(fieldErrs(er).name ?? errMsg(er));
    } finally {
      setBusy(false);
    }
  };
  const rename = async () => {
    if (!editing) return;
    try {
      await patch(`/admin/categories/${editing.id}`, { name: editing.name });
      toast.ok('Category renamed');
      setEditing(null);
      setEditErr(undefined);
      await L.reload();
    } catch (er) {
      setEditErr(fieldErrs(er).name ?? errMsg(er));
    }
  };

  return (
    <Glass>
      <h2>Categories</h2>
      <form className="filters" onSubmit={add}>
        <Field className="grow" label="New category" value={name} onChange={(e) => setName(e.target.value)} error={addErr} maxLength={40} />
        <Button variant="primary" type="submit" busy={busy}>Add</Button>
      </form>
      <Async loading={L.loading && !L.data} error={L.error} onRetry={L.reload}>
        {L.data && (L.data.items.length === 0 ? <Empty icon="🏷️" title="No categories yet" /> : (
          <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {L.data.items.map((c) => (
              <li key={c.id} className="row between detail-box">
                {editing?.id === c.id ? (
                  <form className="row" style={{ flex: 1 }} onSubmit={(e) => { e.preventDefault(); void rename(); }}>
                    <Field label="Category name" value={editing.name} onChange={(e) => setEditing({ id: c.id, name: e.target.value })} error={editErr} autoFocus />
                    <Button variant="primary" size="sm" type="submit">Save</Button>
                    <Button size="sm" type="button" onClick={() => { setEditing(null); setEditErr(undefined); }}>Cancel</Button>
                  </form>
                ) : (
                  <>
                    <strong>{c.name}</strong>
                    <div className="cell-actions">
                      <Button size="sm" onClick={() => setEditing({ id: c.id, name: c.name })} aria-label={`Rename ${c.name}`}>Rename</Button>
                      <Button size="sm" variant="danger" onClick={() => setRemoving(c)} aria-label={`Delete ${c.name}`}>Delete</Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        ))}
      </Async>
      {removing && (
        <ConfirmDialog
          title={`Delete “${removing.name}”?`}
          message="Products in this category stay listed but become uncategorised."
          confirmText="Delete category"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await del(`/admin/categories/${removing.id}`);
            toast.ok('Category removed');
            await L.reload();
          }}
        />
      )}
    </Glass>
  );
}

function Products() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const L = useLoad(() => get<Paged<AdminProduct>>('/admin/products', { search: q, status, page }), [q, status, page]);
  const [target, setTarget] = useState<AdminProduct | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const restore = async (p: AdminProduct) => {
    setBusy(p.id);
    try {
      await post(`/admin/products/${p.id}/restore`);
      toast.ok(`“${p.name}” is live again`);
      await L.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Glass>
      <h2>Product moderation</h2>
      <div className="filters">
        <Field className="grow" label="Search" type="search" placeholder="Product or farmer…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <Chips value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: '', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'taken_down', label: 'Taken down' }]} />
      </div>
      <Async loading={L.loading && !L.data} error={L.error} onRetry={L.reload}>
        {L.data && (L.data.items.length === 0 ? <Empty icon="🥕" title="No products found" /> : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Product</th><th>Farm</th><th>Price</th><th>Stock</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {L.data.items.map((p) => (
                    <tr key={p.id}>
                      <td><strong>{p.name}</strong><div className="small muted">{p.category?.name ?? 'Uncategorised'}</div></td>
                      <td>{p.farmer.farmerProfile?.farmName ?? p.farmer.name}</td>
                      <td>{money(p.price)} / {p.unit}</td>
                      <td>{p.stock}</td>
                      <td>
                        {p.takenDownReason ? <><StatusBadge status="BLOCKED" text="Taken down" /><div className="small muted wrap-text">{p.takenDownReason}</div></> : <StatusBadge status="ACTIVE" text="Live" />}
                      </td>
                      <td>
                        {p.takenDownReason
                          ? <Button size="sm" busy={busy === p.id} onClick={() => restore(p)} aria-label={`Restore ${p.name}`}>Restore</Button>
                          : <Button size="sm" variant="danger" onClick={() => setTarget(p)} aria-label={`Take down ${p.name}`}>Take down</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination data={L.data} onPage={setPage} />
          </>
        ))}
      </Async>
      {target && (
        <ConfirmDialog
          title={`Take down “${target.name}”?`}
          message="It disappears from search and customers' carts. The farmer is notified with your reason."
          confirmText="Take down"
          danger
          reasonLabel="Reason"
          onClose={() => setTarget(null)}
          onConfirm={async (reason) => {
            await post(`/admin/products/${target.id}/takedown`, { reason });
            toast.ok('Listing taken down');
            await L.reload();
          }}
        />
      )}
    </Glass>
  );
}

export default function Catalog() {
  return (
    <div className="stack">
      <PageHead title="Catalogue" subtitle="Keep categories tidy and remove inappropriate listings" />
      <Categories />
      <Products />
    </div>
  );
}
