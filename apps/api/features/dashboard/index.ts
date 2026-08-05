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
    // Default route — 主理人指挥舱 (task:80a5be84)
    { path: '/', component: 'OwnerCockpitPage', requireAuth: true },
    // Dashboard 退役重定向 → 军师台
    { path: '/dashboard', redirect: '/strategist' },
    { path: '/dashboard/command', redirect: '/strategist' },
    { path: '/dashboard/command/*', redirect: '/strategist' },
    { path: '/dashboard/panorama', component: 'PanoramaV3' },
    {
      path: '/dashboard/team',
      component: 'TeamDashboardV1',
      navItem: { label: '团队 Dashboard', icon: 'LayoutGrid', group: 'dashboard' },
    },
    // Legacy redirects
    { path: '/command', redirect: '/strategist' },
    { path: '/command/*', redirect: '/strategist' },
    { path: '/features', redirect: '/work/features' },
  ],

  components: {
    PanoramaV3: () => import('../business/pages/PanoramaV3'),
    TeamDashboardV1: () => import('../business/pages/TeamDashboardV1'),
    OwnerCockpitPage: () => import('../../../dashboard/src/pages/owner-cockpit/OwnerCockpitPage'),
  },
};

export default manifest;
