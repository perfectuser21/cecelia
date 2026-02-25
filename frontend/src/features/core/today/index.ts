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
      component: 'TodayHome',
      navItem: { label: 'Today', icon: 'CalendarDays', group: 'today' },
    },
    { path: '/today/view', component: 'TodayView' },
    { path: '/today/scheduler', component: 'Scheduler' },
    { path: '/today/tasks', component: 'TasksPage' },
    // Legacy redirects
    { path: '/scheduler', redirect: '/today/scheduler' },
  ],

  components: {
    TodayHome: () => import('./pages/TodayHome'),
    TodayView: () => import('../daily/pages/TodayView'),
    Scheduler: () => import('../planning/pages/Scheduler'),
    TasksPage: () => import('../planning/pages/Tasks'),
  },
};

export default manifest;
