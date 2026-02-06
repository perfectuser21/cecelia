import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'dashboard',
  name: 'Dashboard',
  version: '2.0.0',
  source: 'core',
  instances: ['core'],

  navGroups: [
    { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard', order: 1 },
  ],

  routes: [
    {
      path: '/dashboard',
      component: 'DashboardHome',
      navItem: { label: 'Dashboard', icon: 'LayoutDashboard', group: 'dashboard' },
    },
    { path: '/dashboard/command', component: 'CommandCenter' },
    { path: '/dashboard/command/*', component: 'CommandCenter' },
    { path: '/dashboard/panorama', component: 'PanoramaV3' },
    // Default route
    { path: '/', redirect: '/dashboard' },
    // Legacy redirects
    { path: '/command', redirect: '/dashboard/command' },
    { path: '/command/*', redirect: '/dashboard/command' },
    { path: '/features', redirect: '/work/features' },
  ],

  components: {
    DashboardHome: () => import('./pages/DashboardHome'),
    CommandCenter: () => import('../business/pages/CommandCenter'),
    PanoramaV3: () => import('../business/pages/PanoramaV3'),
  },
};

export default manifest;
