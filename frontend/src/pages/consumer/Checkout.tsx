import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { get, post } from '../../api';
import { emitCartChanged } from '../../events';
import { money } from '../../format';
import { errMsg, fieldErrs, useLoad } from '../../hooks';
import type { Cart, CheckoutResult, CartItem, User } from '../../types';
import { Async, Banner, Button, Empty, Glass, PageHead, TextArea } from '../../ui';

export function Checkout() {
  const nav = useNavigate();
  // one key per visit: double-clicks and retries can never create duplicate orders
  const key = useRef(crypto.randomUUID());
  const data = useLoad(async () => {
    const [cart, me, settings] = await Promise.all([get<Cart>('/cart'), get<{ user: User }>('/auth/me'), get<{ deliveryFee: number }>('/settings/public')]);
    return { cart, user: me.user, fee: settings.deliveryFee };
  }, []);
  const [address, setAddress] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data.data && !touched) setAddress(data.data.user.address ?? '');
  }, [data.data, touched]);

  const d = data.data;
  const byFarm = new Map<string, CartItem[]>();
  d?.cart.items.forEach((i) => byFarm.set(i.farmerId, [...(byFarm.get(i.farmerId) ?? []), i]));
  const farms = byFarm.size;
  const grand = d ? d.cart.total + d.fee * farms : 0;
  const addressErr = address.trim().length < 8 ? 'Enter your full delivery address (at least 8 characters)' : serverFields.deliveryAddress;

  const place = async () => {
    setTouched(true);
    if (address.trim().length < 8) return;
    setBusy(true);
    setError(null);
    setServerFields({});
    try {
      const r = await post<CheckoutResult>('/orders/checkout', { deliveryAddress: address.trim(), idempotencyKey: key.current });
      emitCartChanged();
      nav(`/pay/${r.groupId}`);
    } catch (e) {
      setError(errMsg(e));
      setServerFields(fieldErrs(e));
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="Checkout" subtitle="Confirm your address and place the order." />
      <Async loading={data.loading} error={data.error} onRetry={data.reload}>
        {d && d.cart.items.length === 0 ? (
          <Glass><Empty icon="🧺" title="Your cart is empty"><Link className="btn primary" to="/shop">Browse the marketplace</Link></Empty></Glass>
        ) : (
          d && (
            <div className="two-col">
              <div className="stack">
                <Glass className="stack">
                  <h3>Delivery address</h3>
                  <TextArea label="Where should we deliver?" value={address} onChange={(e) => { setTouched(true); setAddress(e.target.value); }} error={touched ? addressErr : serverFields.deliveryAddress} maxLength={300} placeholder="House no., street, city, PIN" />
                </Glass>
                {[...byFarm.entries()].map(([farmerId, items]) => (
                  <Glass key={farmerId} as="section" aria-label={`Order from ${items[0].farmName}`}>
                    <div className="row between"><h3>🌾 {items[0].farmName}</h3><span className="small muted">Separate order · delivery {money(d.fee)}</span></div>
                    {items.map((i) => (
                      <div className="line" key={i.productId}>
                        <span className="grow">{i.quantity} × {i.name}</span>
                        <strong>{money(i.lineTotal)}</strong>
                      </div>
                    ))}
                  </Glass>
                ))}
              </div>
              <Glass className="stack" as="section" aria-label="Order total">
                <h3>Order total</h3>
                <div className="total-row"><span>Items</span><span>{money(d.cart.total)}</span></div>
                <div className="total-row"><span>Delivery ({farms} {farms === 1 ? 'order' : 'orders'} × {money(d.fee)})</span><span>{money(d.fee * farms)}</span></div>
                <div className="total-row grand"><span>Total to pay</span><span>{money(grand)}</span></div>
                {d.cart.hasProblems && <Banner kind="warn">Some items have a problem. <Link to="/cart">Fix your cart</Link> first.</Banner>}
                {error && <Banner kind="error">{error}</Banner>}
                <Button variant="primary" block busy={busy} disabled={d.cart.hasProblems} onClick={place}>Place order &amp; pay</Button>
                <p className="small muted">Your stock is reserved when you place the order. Unpaid orders are released after 30 minutes.</p>
              </Glass>
            </div>
          )
        )}
      </Async>
    </>
  );
}
