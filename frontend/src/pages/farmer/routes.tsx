import type { RouteObject } from 'react-router-dom';
import './farmer.css';
import { Dashboard } from './Dashboard';
import { Earnings } from './Earnings';
import { Inventory } from './Inventory';
import { FarmerOrders } from './Orders';
import { Products } from './Products';

export const farmerRoutes: RouteObject[] = [
  { path: '/farmer', element: <Dashboard /> },
  { path: '/farmer/products', element: <Products /> },
  { path: '/farmer/inventory', element: <Inventory /> },
  { path: '/farmer/orders', element: <FarmerOrders /> },
  { path: '/farmer/earnings', element: <Earnings /> },
];
