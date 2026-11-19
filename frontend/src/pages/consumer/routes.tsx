import type { RouteObject } from 'react-router-dom';
import './consumer.css';
import { Cart } from './Cart';
import { Checkout } from './Checkout';
import { OrderDetail } from './OrderDetail';
import { Orders } from './Orders';
import { Pay } from './Pay';
import { ProductDetail } from './ProductDetail';
import { Shop } from './Shop';

// Paths are absolute. Rendered inside <Shell> for the CONSUMER role.
export const consumerRoutes: RouteObject[] = [
  { path: '/shop', element: <Shop /> },
  { path: '/shop/product/:id', element: <ProductDetail /> },
  { path: '/cart', element: <Cart /> },
  { path: '/checkout', element: <Checkout /> },
  { path: '/pay/:groupId', element: <Pay /> },
  { path: '/orders', element: <Orders /> },
  { path: '/orders/:id', element: <OrderDetail /> },
];
