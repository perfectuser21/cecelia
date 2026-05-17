import { NavLink, useLocation, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';

const BrainSystemTab    = lazy(() => import('./BrainSystemTab'));
const MaintenanceTab    = lazy(() => import('./MaintenanceTab'));
const NotificationsTab  = lazy(() => import('./NotificationsTab'));
const AccountsTab       = lazy(() => import('./AccountsTab'));

const NAV_ITEMS = [
  { to: '/settings/brain',         label: 'Brain 系统',  component: BrainSystemTab   },
  { to: '/settings/maintenance',   label: '维护',         component: MaintenanceTab   },
  { to: '/settings/notifications', label: '通知',         component: NotificationsTab },
  { to: '/settings/accounts',      label: '账户',         component: AccountsTab      },
];

function LoadingFallback() {
  return <p className="text-sm text-gray-500">加载中...</p>;
}

export default function SettingsLayout() {
  const location = useLocation();

  if (location.pathname === '/settings' || location.pathname === '/settings/') {
    return <Navigate to="/settings/brain" replace />;
  }

  const current = NAV_ITEMS.find(item => location.pathname.startsWith(item.to));
  const TabComponent = current?.component ?? BrainSystemTab;

  return (
    <div className="flex h-full min-h-screen bg-gray-950 text-gray-100">
      <nav className="w-48 shrink-0 border-r border-gray-800 pt-6 px-3">
        <p className="mb-4 px-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
          设置
        </p>
        {NAV_ITEMS.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `block rounded-md px-3 py-2 text-sm mb-1 transition-colors ${
                isActive
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <main className="flex-1 overflow-auto p-8">
        <Suspense fallback={<LoadingFallback />}>
          <TabComponent />
        </Suspense>
      </main>
    </div>
  );
}
