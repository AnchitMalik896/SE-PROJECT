import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, post } from '../../api';
import { useAuth } from '../../auth';
import { ProductCard } from '../../components/ProductCard';
import { emitCartChanged } from '../../events';
import { emojiFor, money } from '../../format';
import { errMsg, useDebounced, useLoad } from '../../hooks';
import type { Category, Paged, Product } from '../../types';
import { Async, Button, Chips, Empty, Glass, Pagination, Stars, useToast } from '../../ui';

function useAddToCart() {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const add = async (p: Product, quantity = 1) => {
    if (!user) return nav('/login', { state: { from: '/browse' } });
    if (user.role !== 'CONSUMER') return toast.error('Only customer accounts can buy produce.');
    setBusyId(p.id);
    try {
      await post('/cart', { productId: p.id, quantity });
      emitCartChanged();
      toast.ok(`${p.name} added to your cart`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyId(null);
    }
  };
  return { add, busyId, canBuy: !user || user.role === 'CONSUMER' };
}

export function Browse() {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [sort, setSort] = useState('new');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const cats = useLoad(() => get<{ items: Category[] }>('/categories'), []);
  const list = useLoad(() => get<Paged<Product>>('/products', { search: q, categoryId, sort, page, pageSize: 12 }), [q, categoryId, sort, page]);
  const { add, busyId, canBuy } = useAddToCart();

  return (
    <div className="stack">
      <div className="page-head"><div><h1>Browse fresh produce</h1><p>Straight from verified local farms.</p></div></div>
      <Glass className="stack">
        <div className="row">
          <input className="input" style={{ flex: '1 1 240px' }} type="search" placeholder="Search tomatoes, honey, a farm…" aria-label="Search produce" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <select className="select" style={{ width: 'auto' }} aria-label="Sort" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
            <option value="new">Newest</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
          </select>
        </div>
        <Chips value={categoryId} onChange={(v) => { setCategoryId(v); setPage(1); }} options={[{ value: '', label: 'All' }, ...(cats.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
      </Glass>
      <Async loading={list.loading && !list.data} error={list.error} onRetry={list.reload}>
        {list.data && list.data.items.length === 0 ? (
          <Glass><Empty icon="🔍" title="No produce found">Try a different search or category.</Empty></Glass>
        ) : (
          <>
            <div className="grid cols-4">
              {list.data?.items.map((p) => (
                <ProductCard key={p.id} product={p} to={`/browse/${p.id}`} onAdd={canBuy ? (x) => add(x) : undefined} adding={busyId === p.id} />
              ))}
            </div>
            {list.data && <Pagination data={list.data} onPage={setPage} />}
          </>
        )}
      </Async>
    </div>
  );
}

export function BrowseProduct() {
  const { id } = useParams();
  const [qty, setQty] = useState(1);
  const p = useLoad(() => get<{ product: Product }>(`/products/${id}`), [id]);
  const reviews = useLoad(() => get<{ items: { id: string; stars: number; comment: string | null; consumerName: string }[] }>(`/products/${id}/ratings`), [id]);
  const { add, busyId, canBuy } = useAddToCart();
  const product = p.data?.product;

  return (
    <div className="stack">
      <Link to="/browse">← All produce</Link>
      <Async loading={p.loading} error={p.error} onRetry={p.reload}>
        {product && (
          <div className="grid cols-2">
            <Glass style={{ display: 'grid', placeItems: 'center', minHeight: 260, fontSize: '6rem', padding: 0, overflow: 'hidden' }}>
              {product.photoUrl ? <img src={product.photoUrl} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span aria-hidden>{emojiFor(product.category?.name)}</span>}
            </Glass>
            <Glass className="stack">
              <div>
                {product.category && <span className="badge">{product.category.name}</span>}
                <h1 style={{ marginTop: '0.4rem' }}>{product.name}</h1>
                <div className="price" style={{ fontSize: '1.7rem' }}>{money(product.price)} <span className="small muted">/ {product.unit}</span></div>
              </div>
              <p>{product.description || 'Freshly harvested.'}</p>
              <div className="small">
                <strong>{product.farmer.farmName}</strong> · {product.farmer.farmLocation}<br />
                <Stars value={product.farmer.rating} count={product.farmer.ratingCount} />
              </div>
              <div className="small muted">{product.stock} {product.unit} in stock</div>
              {canBuy && (
                <div className="row">
                  <div className="qty">
                    <button aria-label="Decrease quantity" disabled={qty <= 1} onClick={() => setQty((q) => q - 1)}>−</button>
                    <span aria-live="polite">{qty}</span>
                    <button aria-label="Increase quantity" disabled={qty >= product.stock} onClick={() => setQty((q) => q + 1)}>+</button>
                  </div>
                  <Button variant="primary" busy={busyId === product.id} onClick={() => add(product, qty)}>Add to cart</Button>
                </div>
              )}
            </Glass>
          </div>
        )}
      </Async>
      {reviews.data && reviews.data.items.length > 0 && (
        <Glass className="stack">
          <h2>Reviews</h2>
          {reviews.data.items.map((r) => (
            <div key={r.id}><Stars value={r.stars} /> <strong>{r.consumerName}</strong>{r.comment && <p className="muted" style={{ margin: '0.2rem 0 0' }}>{r.comment}</p>}</div>
          ))}
        </Glass>
      )}
    </div>
  );
}
