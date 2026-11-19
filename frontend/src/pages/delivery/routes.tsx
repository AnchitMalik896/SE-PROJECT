import type { RouteObject } from 'react-router-dom';
import './delivery.css';
import { Available } from './Available';
import { DeliveryDetail } from './Detail';
import { Mine } from './Mine';

// Paths are absolute. Rendered inside <Shell> for the DELIVERY role.
export const deliveryRoutes: RouteObject[] = [
  { path: '/delivery', element: <Available /> },
  { path: '/delivery/mine', element: <Mine /> },
  { path: '/delivery/:id', element: <DeliveryDetail /> },
];
