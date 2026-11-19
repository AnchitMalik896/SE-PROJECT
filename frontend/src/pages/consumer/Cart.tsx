import { useState } from 'react';
import { Link } from 'react-router-dom';
import { del, get, patch } from '../../api';
import { emitCartChanged } from '../../events';
import { money } from '../../format';
import { errMsg, useLoad } from '../../hooks';
import type { Cart as CartT, CartItem } from '../../types';
import { Async, Banner, Button, Empty, Glass, PageHead, useToast } from '../../ui';

export function Cart() {
  const toast = useToast();
  const cart = useLoad(() => get<CartT>('/cart'), []);
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = async (id: string, fn: () => Promise<CartT>) => {
    setBusyId(id);
    try {
      cart.setData(await fn());
      emitCartChanged();
    } catch (e) {
      toast.error(errMsg(e));
      void cart.reload();
    } finally {
      setBusyId(null);
    }
  };
  const setQty = (i: CartItem, q: number) => run(i.productId, () => patch<CartT>(`/cart/${i.productId}`, { quantity: q }));
  const remove = (i: CartItem) => run(i.productId, () => del<CartT>(`/cart/${i.productId}`));

  const c = cart.data;
  const byFarm = new Map<string, CartItem[]>();
  c?.items.forEach((i) => byFarm.set(i.farmName, [...(byFarm.get(i.farmName) ?? []), i]));

  return (
    <>
      <PageHead title="Your cart" subtitle="Review your items before checking out." />
      <Async loading={cart.loading} error={cart.error} onRetry={cart.reload}>
        {c && c.items.length === 0 ? (
          <Glass><Empty icon="🧺" title="Your cart is empty"><Link className="btn primary" to="/shop">Browse the marketplace</Link></Empty></Glass>
        ) : (
          c && (
            <div className="two-col">
              <div className="stack">
                {[...byFarm.entries()].map(([farm, items]) => (
                  <Glass key={farm} as="section" aria-label={`Items from ${farm}`}>
                    <h3>🌾 {farm}</h3>
                    {items.map((i) => (
                      <div className="line" key={i.productId}>
                        <div className="grow">
                          <strong>{i.name}</strong>
                          <div className="small muted">{money(i.price)} / {i.unit}</div>
                          {i.problem && <div className="small" role="alert" style={{ color: 'var(--danger)', fontWeight: 700 }}>⚠ {i.problem}</div>}
                        </div>
                        <div className="qty" role="group" aria-label={`Quantity of ${i.name}`}>
                          <button aria-label={`Decrease ${i.name}`} disabled={busyId === i.productId || i.quantity <= 1} onClick={() => setQty(i, i.quantity - 1)}>−</button>
                          <span>{i.quantity}</span>
                          <button aria-label={`Increase ${i.name}`} disabled={busyId === i.productId || i.quantity >= i.stock || !i.available} onClick={() => setQty(i, i.quantity + 1)}>+</button>
                        </div>
                        <strong style={{ minWidth: '5ch', textAlign: 'right' }}>{money(i.lineTotal)}</strong>
                        <Button size="sm" variant="ghost" disabled={busyId === i.productId} onClick={() => remove(i)} aria-label={`Remove ${i.name}`}>Remove</Button>
                      </div>
                    ))}
                  </Glass>
                ))}
              </div>
              <Glass className="stack" as="section" aria-label="Order summary">
                <h3>Summary</h3>
                <div className="total-row"><span>Items ({c.count})</span><strong>{money(c.total)}</strong></div>
                <p className="small muted">A delivery fee is added at checkout — once for each farm you order from.</p>
                {c.hasProblems && <Banner kind="warn">Fix or remove the highlighted items to continue.</Banner>}
                {c.hasProblems ? <Button variant="primary" block disabled>Proceed to checkout</Button> : <Link className="btn primary block" to="/checkout">Proceed to checkout</Link>}
              </Glass>
            </div>
          )
        )}
      </Async>
    </>
  );
}
