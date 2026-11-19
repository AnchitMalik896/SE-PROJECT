import type { RouteObject } from 'react-router-dom';
import './admin.css';
import Catalog from './Catalog';
import Complaints from './Complaints';
import Farmers from './Farmers';
import Logs from './Logs';
import Orders from './Orders';
import Overview from './Overview';
import Payments from './Payments';
import People from './People';
import Settings from './Settings';

// Paths are absolute (e.g. '/admin'). Rendered inside <Shell> for the ADMIN role.
export const adminRoutes: RouteObject[] = [
  { path: '/admin', element: <Overview /> },
  { path: '/admin/farmers', element: <Farmers /> },
  { path: '/admin/users', element: <People /> },
  { path: '/admin/catalog', element: <Catalog /> },
  { path: '/admin/orders', element: <Orders /> },
  { path: '/admin/payments', element: <Payments /> },
  { path: '/admin/complaints', element: <Complaints /> },
  { path: '/admin/logs', element: <Logs /> },
  { path: '/admin/settings', element: <Settings /> },
];
