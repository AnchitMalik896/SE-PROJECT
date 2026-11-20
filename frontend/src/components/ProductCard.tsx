import { Leaf } from 'lucide-react';
import { Link } from 'react-router-dom';
import { money } from '../format';
import type { Product } from '../types';
import { Button, Stars } from '../ui';

export function ProductCard({ product: p, to, onAdd, adding }: { product: Product; to: string; onAdd?: (p: Product) => void; adding?: boolean }) {
  return (
    <article className="glass product-card card hover" style={{ padding: 0 }}>
      <Link to={to} className="thumb" aria-label={`View ${p.name}`} style={{ textDecoration: 'none' }}>
        {p.photoUrl ? <img src={p.photoUrl} alt="" loading="lazy" /> : <Leaf className="icon" aria-hidden />}
      </Link>
      <div className="body">
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <h3 style={{ margin: 0 }}><Link to={to} style={{ color: 'inherit', textDecoration: 'none' }}>{p.name}</Link></h3>
          {p.category && <span className="badge">{p.category.name}</span>}
        </div>
        <div className="small muted">{p.farmer.farmName} · {p.farmer.farmLocation.split(',')[0]}</div>
        <Stars value={p.farmer.rating} count={p.farmer.ratingCount} />
        <div className="row between" style={{ marginTop: 'auto' }}>
          <span className="price">{money(p.price)} <span className="small muted">/ {p.unit}</span></span>
          {onAdd ? (
            <Button size="sm" variant="primary" busy={adding} onClick={() => onAdd(p)} aria-label={`Add ${p.name} to cart`}>Add</Button>
          ) : (
            <Link className="btn sm" to={to}>View</Link>
          )}
        </div>
        {p.stock <= 5 && <span className="small" style={{ color: 'var(--warn)', fontWeight: 700 }}>Only {p.stock} left</span>}
      </div>
    </article>
  );
}
