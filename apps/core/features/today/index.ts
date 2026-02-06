import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'today',
  name: 'Today',
  version: '1.0.0',
  source: 'core',
  instances: ['core'],

  navGroups: [
    { id: 'today', label: 'Today', icon: 'CalendarDays', order: 2 },
  ],

  routes: [
    {
      path: '/today',
      component: 'TodayTabbed',
      navItem: { label: 'Today', icon: 'CalendarDays', group: 'today' },
    },
    { path: '/today/schedule', component: 'TodayTabbed' },
    { path: '/today/queue', component: 'TodayTabbed' },
    // Redirects from old paths
    { path: '/today/view', redirect: '/today' },
    { path: '/today/tasks', redirect: '/today/schedule' },
    { path: '/today/scheduler', redirect: '/today/queue' },
    // Legacy redirects
    { path: '/scheduler', redirect: '/today/queue' },
  ],

  components: {
    TodayTabbed: () => import('./pages/TodayTabbed'),
  },
};

export default manifest;
