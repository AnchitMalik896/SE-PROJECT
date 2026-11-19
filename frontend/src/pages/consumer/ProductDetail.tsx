import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post } from '../../api';
import { emitCartChanged } from '../../events';
import { dateOnly, emojiFor, money } from '../../format';
import { errMsg, useLoad } from '../../hooks';
import type { Product } from '../../types';
import { Async, Button, Empty, Glass, Stars, useToast } from '../../ui';

interface Review { id: string; stars: number; comment: string | null; consumerName: string; createdAt: string }

export function ProductDetail() {
  const { id = '' } = useParams();
  const toast = useToast();
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const prod = useLoad(() => get<{ product: Product }>(`/products/${id}`), [id]);
  const reviews = useLoad(() => get<{ items: Review[] }>(`/products/${id}/ratings`), [id]);
  const p = prod.data?.product;

  const add = async () => {
    if (!p) return;
    setBusy(true);
    try {
      await post('/cart', { productId: p.id, quantity: qty });
      emitCartChanged();
      toast.ok(`Added ${qty} × ${p.name} to your cart`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p><Link to="/shop">← Back to marketplace</Link></p>
      <Async loading={prod.loading} error={prod.error} onRetry={prod.reload}>
        {p && (
          <div className="stack">
            <div className="detail-grid">
              <div className="big-thumb glass">{p.photoUrl ? <img src={p.photoUrl} alt={p.name} /> : <span aria-hidden>{emojiFor(p.category?.name)}</span>}</div>
              <Glass className="stack">
                <div>
                  {p.category && <span className="badge">{p.category.name}</span>}
                  <h1 style={{ marginTop: '0.4rem' }}>{p.name}</h1>
                  <div className="price" style={{ fontSize: '1.7rem' }}>{money(p.price)} <span className="small muted">per {p.unit}</span></div>
                </div>
                {p.description && <p>{p.description}</p>}
                <dl className="kv">
                  <dt>Farm</dt><dd>{p.farmer.farmName}</dd>
                  <dt>Location</dt><dd>{p.farmer.farmLocation}</dd>
                  <dt>Farmer rating</dt><dd><Stars value={p.farmer.rating} count={p.farmer.ratingCount} /></dd>
                  <dt>Availability</dt><dd>{p.inStock ? `${p.stock} ${p.unit} in stock` : <span className="badge danger">Out of stock</span>}</dd>
                </dl>
                {p.inStock && (
                  <div className="row">
                    <div className="qty" role="group" aria-label="Quantity">
                      <button aria-label="Decrease quantity" disabled={qty <= 1} onClick={() => setQty((q) => q - 1)}>−</button>
                      <span aria-live="polite">{qty}</span>
                      <button aria-label="Increase quantity" disabled={qty >= p.stock} onClick={() => setQty((q) => Math.min(p.stock, q + 1))}>+</button>
                    </div>
                    <Button variant="primary" busy={busy} onClick={add}>Add to cart · {money(p.price * qty)}</Button>
                    <Link className="btn" to="/cart">View cart</Link>
                  </div>
                )}
              </Glass>
            </div>

            <Glass>
              <h2>Reviews</h2>
              <Async loading={reviews.loading} error={reviews.error} onRetry={reviews.reload}>
                {reviews.data && reviews.data.items.length === 0 ? (
                  <Empty icon="⭐" title="No reviews yet">Reviews appear after customers receive this product.</Empty>
                ) : (
                  reviews.data?.items.slice(0, 8).map((r) => (
                    <div className="line" key={r.id}>
                      <div className="grow">
                        <div className="row"><Stars value={r.stars} /><strong>{r.consumerName}</strong><span className="small muted">{dateOnly(r.createdAt)}</span></div>
                        {r.comment && <p style={{ margin: '0.25rem 0 0' }}>{r.comment}</p>}
                      </div>
                    </div>
                  ))
                )}
              </Async>
            </Glass>
          </div>
        )}
      </Async>
    </>
  );
}
