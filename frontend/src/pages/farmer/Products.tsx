import { useState } from 'react';
import { del, get, patch, post } from '../../api';
import { emojiFor, fromPaise, money, toPaise } from '../../format';
import { errMsg, fieldErrs, useLoad } from '../../hooks';
import type { Category, FarmerProduct } from '../../types';
import { Async, Banner, Button, ConfirmDialog, Empty, Field, Glass, Modal, PageHead, Select, TextArea, useToast } from '../../ui';

interface Form { name: string; categoryId: string; price: string; unit: string; stock: string; photoUrl: string; description: string }
const blank: Form = { name: '', categoryId: '', price: '', unit: 'kg', stock: '0', photoUrl: '', description: '' };

function ProductForm({ product, categories, onClose, onSaved }: { product: FarmerProduct | null; categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Form>(
    product
      ? { name: product.name, categoryId: product.categoryId ?? '', price: fromPaise(product.price), unit: product.unit, stock: String(product.stock), photoUrl: product.photoUrl ?? '', description: product.description }
      : blank,
  );
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    const price = toPaise(f.price);
    if (price === null || f.price.trim() === '') local.price = 'Enter a price in rupees';
    const stock = Number(f.stock);
    if (!Number.isInteger(stock) || stock < 0) local.stock = 'Stock must be a whole number, 0 or more';
    if (Object.keys(local).length) return setErrs(local);
    setBusy(true);
    setErrs({});
    setFormErr(null);
    const body = { name: f.name, description: f.description, price, unit: f.unit, stock, photoUrl: f.photoUrl, categoryId: f.categoryId };
    try {
      if (product) await patch(`/farmer/products/${product.id}`, body);
      else await post('/farmer/products', body);
      toast.ok(product ? 'Product updated' : 'Product added');
      onSaved();
      onClose();
    } catch (err) {
      setErrs(fieldErrs(err));
      setFormErr(errMsg(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={product ? 'Edit product' : 'Add a product'} onClose={onClose}>
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Name" value={f.name} onChange={set('name')} error={errs.name} required maxLength={80} />
        <div className="form-grid">
          <Select label="Category" value={f.categoryId} onChange={set('categoryId')} error={errs.categoryId}>
            <option value="">No category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Field label="Unit" value={f.unit} onChange={set('unit')} error={errs.unit} hint="kg, dozen, bunch…" required />
        </div>
        <div className="form-grid">
          <Field label="Price (₹ per unit)" inputMode="decimal" value={f.price} onChange={set('price')} error={errs.price} required />
          <Field label="Stock available" inputMode="numeric" value={f.stock} onChange={set('stock')} error={errs.stock} required />
        </div>
        <Field label="Photo URL (optional)" type="url" value={f.photoUrl} onChange={set('photoUrl')} error={errs.photoUrl} placeholder="https://…" />
        {f.photoUrl && /^https?:\/\//i.test(f.photoUrl) && <img className="photo-preview" src={f.photoUrl} alt="Product preview" onError={(e) => (e.currentTarget.style.display = 'none')} />}
        <TextArea label="Description" value={f.description} onChange={set('description')} error={errs.description} maxLength={500} />
        {formErr && Object.keys(errs).length === 0 && <Banner kind="error">{formErr}</Banner>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy}>{product ? 'Save changes' : 'Add product'}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function Products() {
  const toast = useToast();
  const list = useLoad(() => get<{ items: FarmerProduct[] }>('/farmer/products'));
  const cats = useLoad(() => get<{ items: Category[] }>('/categories'));
  const [editing, setEditing] = useState<FarmerProduct | 'new' | null>(null);
  const [removing, setRemoving] = useState<FarmerProduct | null>(null);

  return (
    <>
      <PageHead title="Your products" subtitle="Changes appear to customers immediately" actions={<Button variant="primary" onClick={() => setEditing('new')}>+ Add product</Button>} />
      <Async loading={list.loading} error={list.error} onRetry={list.reload}>
        {list.data && list.data.items.length === 0 ? (
          <Glass><Empty icon="🥕" title="No products yet">Add your first product so customers can find it.</Empty></Glass>
        ) : (
          <div className="grid cols-3">
            {list.data?.items.map((p) => (
              <Glass key={p.id} className="stack">
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <div className="f-thumb" aria-hidden>{p.photoUrl ? <img src={p.photoUrl} alt="" /> : emojiFor(p.category?.name)}</div>
                  <div style={{ minWidth: 0 }}>
                    <h3 style={{ margin: 0 }}>{p.name}</h3>
                    <div className="small muted">{p.category?.name ?? 'Uncategorised'}</div>
                  </div>
                </div>
                <div className="row between">
                  <span className="price">{money(p.price)} <span className="small muted">/ {p.unit}</span></span>
                  {p.stock === 0 ? <span className="badge danger">Out of stock</span> : <span className="badge">{p.stock} in stock</span>}
                </div>
                {p.takenDownReason && <Banner kind="warn">Hidden from customers — taken down by an administrator: {p.takenDownReason}</Banner>}
                <div className="row">
                  <Button size="sm" onClick={() => setEditing(p)}>Edit</Button>
                  <Button size="sm" variant="danger" onClick={() => setRemoving(p)}>Remove</Button>
                </div>
              </Glass>
            ))}
          </div>
        )}
      </Async>
      {editing && <ProductForm product={editing === 'new' ? null : editing} categories={cats.data?.items ?? []} onClose={() => setEditing(null)} onSaved={list.reload} />}
      {removing && (
        <ConfirmDialog
          title={`Remove “${removing.name}”?`}
          message="It will disappear from search and customers' carts. Past orders keep their history."
          confirmText="Remove product"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            try {
              await del(`/farmer/products/${removing.id}`);
            } catch (e) {
              throw new Error(errMsg(e));
            }
            toast.ok('Product removed');
            await list.reload();
          }}
        />
      )}
    </>
  );
}
