import { useEffect, useState } from 'react';
import { Bell, Bike, CreditCard, ClipboardList, Carrot, LayoutDashboard, MapPin, Menu, MessageCircle, Moon, Package, Scale, ScrollText, Settings, ShoppingBag, ShoppingBasket, Sprout, Sun, Tags, User, Users, Wallet, Wheat, type LucideIcon } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { get } from '../api';
import { homeFor, useAuth } from '../auth';
import type { Role } from '../types';
import { useTheme } from '../theme';
import { Button } from '../ui';

interface NavItem { to: string; label: string; icon: LucideIcon; end?: boolean; badge?: 'cart' }

const NAV: Record<Role, NavItem[]> = {
  CONSUMER: [
    { to: '/shop', label: 'Marketplace', icon: ShoppingBag, end: true },
    { to: '/cart', label: 'Cart', icon: ShoppingBasket, badge: 'cart' },
    { to: '/orders', label: 'My orders', icon: Package },
    { to: '/support', label: 'Help & complaints', icon: MessageCircle },
  ],
  FARMER: [
    { to: '/farmer', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/farmer/products', label: 'Products', icon: Carrot },
    { to: '/farmer/inventory', label: 'Inventory', icon: ClipboardList },
    { to: '/farmer/orders', label: 'Orders', icon: Package },
    { to: '/farmer/earnings', label: 'Earnings', icon: Wallet },
    { to: '/support', label: 'Help & complaints', icon: MessageCircle },
  ],
  DELIVERY: [
    { to: '/delivery', label: 'Available', icon: MapPin, end: true },
    { to: '/delivery/mine', label: 'My deliveries', icon: Bike },
    { to: '/support', label: 'Help & complaints', icon: MessageCircle },
  ],
  ADMIN: [
    { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/admin/farmers', label: 'Farmers', icon: Sprout },
    { to: '/admin/users', label: 'People', icon: Users },
    { to: '/admin/catalog', label: 'Catalogue', icon: Tags },
    { to: '/admin/orders', label: 'Orders', icon: Package },
    { to: '/admin/payments', label: 'Payments', icon: CreditCard },
    { to: '/admin/complaints', label: 'Complaints', icon: Scale },
    { to: '/admin/logs', label: 'Activity logs', icon: ScrollText },
    { to: '/admin/settings', label: 'Settings', icon: Settings },
  ],
};

const ROLE_LABEL: Record<Role, string> = { CONSUMER: 'Customer', FARMER: 'Farmer', DELIVERY: 'Delivery partner', ADMIN: 'Administrator' };

function ThemeButton() {
  const { theme, toggle } = useTheme();
  return (
    <button className="btn ghost sm" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title="Toggle theme">
      {theme === 'dark' ? <Sun className="icon" /> : <Moon className="icon" />}
    </button>
  );
}

export function Shell() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [cartCount, setCartCount] = useState(0);

  useEffect(() => setOpen(false), [loc.pathname]);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const loadN = () => get<{ unread: number }>('/notifications').then((r) => alive && setUnread(r.unread)).catch(() => {});
    const loadC = () => user.role === 'CONSUMER' && get<{ count: number }>('/cart').then((r) => alive && setCartCount(r.count)).catch(() => {});
    loadN();
    loadC();
    const t = setInterval(() => document.visibilityState === 'visible' && loadN(), 30_000);
    window.addEventListener('fd:notifications', loadN);
    window.addEventListener('fd:cart', loadC as () => void);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener('fd:notifications', loadN);
      window.removeEventListener('fd:cart', loadC as () => void);
    };
  }, [user]);

  if (!user) return null;
  const items = NAV[user.role];

  return (
    <div className="shell">
      <aside className={`glass sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
        <Link to={homeFor(user.role)} className="brand"><span className="logo"><Wheat className="icon" /></span> FarmDirect</Link>
        <nav className="nav stack" style={{ gap: '0.2rem' }}>
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <i.icon className="icon" aria-hidden /> {i.label}
              {i.badge === 'cart' && cartCount > 0 && <span className="count">{cartCount}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="spacer" />
        <nav className="nav stack" style={{ gap: '0.2rem' }}>
          <NavLink to="/notifications" className={({ isActive }) => (isActive ? 'active' : '')}>
            <Bell className="icon" aria-hidden /> Notifications {unread > 0 && <span className="count">{unread}</span>}
          </NavLink>
          <NavLink to="/profile" className={({ isActive }) => (isActive ? 'active' : '')}><User className="icon" aria-hidden /> Profile</NavLink>
        </nav>
      </aside>

      <div className="main">
        <header className="glass topbar">
          <div className="row">
            <button className="btn ghost sm menu-btn" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Menu className="icon" /></button>
            <div>
              <strong>{user.name}</strong>
              <div className="small muted">{ROLE_LABEL[user.role]}</div>
            </div>
          </div>
          <div className="row" style={{ gap: '0.3rem' }}>
            <Link className="btn ghost sm bell" to="/notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
              <Bell className="icon" />{unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
            </Link>
            <ThemeButton />
            <Button size="sm" onClick={async () => { await logout(); nav('/login'); }}>Log out</Button>
          </div>
        </header>
        <main className="content" id="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function PublicLayout() {
  const { user } = useAuth();
  return (
    <>
      <header className="glass public-nav">
        <Link to="/" className="brand" style={{ padding: 0 }}><span className="logo"><Wheat className="icon" /></span> FarmDirect</Link>
        <nav className="row" style={{ gap: '0.4rem' }}>
          <Link className="btn ghost sm" to="/browse">Browse produce</Link>
          <ThemeButton />
          {user ? (
            <Link className="btn primary sm" to={homeFor(user.role)}>Open dashboard</Link>
          ) : (
            <>
              <Link className="btn sm" to="/login">Log in</Link>
              <Link className="btn primary sm" to="/register">Sign up</Link>
            </>
          )}
        </nav>
      </header>
      <main className="public-main" id="main"><Outlet /></main>
    </>
  );
}
