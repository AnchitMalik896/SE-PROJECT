import { useState } from 'react';
import { get, post } from '../../api';
import { ProductCard } from '../../components/ProductCard';
import { emitCartChanged } from '../../events';
import { toPaise } from '../../format';
import { errMsg, useDebounced, useLoad } from '../../hooks';
import type { Category, Paged, Product } from '../../types';
import { Async, Chips, Empty, Field, PageHead, Pagination, Select, useToast } from '../../ui';

const priceParam = (v: string) => (v.trim() === '' ? undefined : (toPaise(v) ?? undefined));

export function Shop() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [sort, setSort] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState<string | null>(null);
  const q = useDebounced(search);
  const dMin = useDebounced(min);
  const dMax = useDebounced(max);

  const cats = useLoad(() => get<{ items: Category[] }>('/categories'), []);
  const list = useLoad(
    () => get<Paged<Product>>('/products', { search: q, categoryId, minPrice: priceParam(dMin), maxPrice: priceParam(dMax), sort, page }),
    [q, categoryId, dMin, dMax, sort, page],
  );

  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  const add = async (p: Product) => {
    setAdding(p.id);
    try {
      await post('/cart', { productId: p.id, quantity: 1 });
      emitCartChanged();
      toast.ok(`${p.name} added to your cart`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setAdding(null);
    }
  };

  return (
    <>
      <PageHead title="Marketplace" subtitle="Fresh produce straight from verified farms." />
      <div className="glass card stack" style={{ marginBottom: '1rem' }}>
        <div className="filters">
          <Field label="Search" type="search" placeholder="Tomatoes, honey, a farm…" value={search} onChange={(e) => reset(setSearch)(e.target.value)} />
          <Field label="Min price (₹)" type="number" min={0} inputMode="decimal" value={min} onChange={(e) => reset(setMin)(e.target.value)} />
          <Field label="Max price (₹)" type="number" min={0} inputMode="decimal" value={max} onChange={(e) => reset(setMax)(e.target.value)} />
          <Select label="Sort by" value={sort} onChange={(e) => reset(setSort)(e.target.value)}>
            <option value="">Newest</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
          </Select>
        </div>
        <Chips
          value={categoryId}
          onChange={reset(setCategoryId)}
          options={[{ value: '', label: 'All' }, ...(cats.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))]}
        />
      </div>

      <Async loading={list.loading} error={list.error} onRetry={list.reload}>
        {list.data && list.data.items.length === 0 ? (
          <Empty icon="🔍" title="Nothing matches your filters">Try a different search or clear the filters.</Empty>
        ) : (
          list.data && (
            <>
              <div className="grid cols-3">
                {list.data.items.map((p) => (
                  <ProductCard key={p.id} product={p} to={`/shop/product/${p.id}`} onAdd={add} adding={adding === p.id} />
                ))}
              </div>
              <Pagination data={list.data} onPage={setPage} />
            </>
          )
        )}
      </Async>
    </>
  );
}
