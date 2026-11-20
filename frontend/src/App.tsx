import { Navigate, useRoutes, type RouteObject } from 'react-router-dom';
import { RequireRole, homeFor, useAuth } from './auth';
import { PublicLayout, Shell } from './components/Layout';
import { adminRoutes } from './pages/admin/routes';
import { consumerRoutes } from './pages/consumer/routes';
import { deliveryRoutes } from './pages/delivery/routes';
import { farmerRoutes } from './pages/farmer/routes';
import { ForgotPassword, Landing, Login, NotFound, Register, ResetPassword } from './pages/public/pages';
import { Browse, BrowseProduct } from './pages/public/browse';
import { NotificationsPage, ProfilePage, SupportPage } from './pages/shared/pages';

function Home() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Navigate to={homeFor(user.role)} replace /> : <Landing />;
}

const shell = (roles: Parameters<typeof RequireRole>[0]['roles'], children: RouteObject[]): RouteObject => ({
  element: (
    <RequireRole roles={roles}>
      <Shell />
    </RequireRole>
  ),
  children,
});

const routes: RouteObject[] = [
  {
    element: <PublicLayout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/login', element: <Login /> },
      { path: '/register', element: <Register /> },
      { path: '/forgot-password', element: <ForgotPassword /> },
      { path: '/reset-password', element: <ResetPassword /> },
      { path: '/browse', element: <Browse /> },
      { path: '/browse/:id', element: <BrowseProduct /> },
    ],
  },
  shell(['CONSUMER'], consumerRoutes),
  shell(['FARMER'], farmerRoutes),
  shell(['DELIVERY'], deliveryRoutes),
  shell(['ADMIN'], adminRoutes),
  shell(['CONSUMER', 'FARMER', 'DELIVERY', 'ADMIN'], [
    { path: '/notifications', element: <NotificationsPage /> },
    { path: '/profile', element: <ProfilePage /> },
  ]),
  shell(['CONSUMER', 'FARMER', 'DELIVERY'], [{ path: '/support', element: <SupportPage /> }]),
  { path: '*', element: <PublicLayout />, children: [{ path: '*', element: <NotFound /> }] },
];

export function App() {
  return (
    <>
      {useRoutes(routes)}
    </>
  );
}
