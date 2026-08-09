import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'workbench', name: 'Cecelia Workbench', version: '1.0.0', source: 'core', instances: ['core'],
  navGroups: [{ id: 'workbench', label: 'Workbench', icon: 'PanelsTopLeft', order: 0 }],
  routes: [
    {
      path: '/workbench', redirect: '/workbench/overview', requireAuth: true,
      navItem: {
        label: 'Workbench', icon: 'PanelsTopLeft', group: 'workbench', order: 0,
        children: [
          { path: '/workbench/overview', label: 'Overview', icon: 'Gauge', order: 0 },
          { path: '/workbench/inbox', label: 'Inbox', icon: 'Inbox', order: 1 },
          { path: '/workbench/tasks', label: 'Tasks', icon: 'ListTodo', order: 2 },
          { path: '/workbench/activity', label: 'Activity', icon: 'Activity', order: 3 },
          { path: '/workbench/projections', label: 'Projections', icon: 'RefreshCcw', order: 4 },
        ],
      },
    },
    { path: '/workbench/overview', component: 'WorkbenchOverview', requireAuth: true },
    { path: '/workbench/inbox', component: 'WorkbenchInbox', requireAuth: true },
    { path: '/workbench/tasks', component: 'WorkbenchTasks', requireAuth: true },
    { path: '/workbench/activity', component: 'WorkbenchActivity', requireAuth: true },
    { path: '/workbench/projections', component: 'WorkbenchProjections', requireAuth: true },
  ],
  components: {
    WorkbenchOverview: () => import('../../../dashboard/src/pages/owner-cockpit/OwnerCockpitPage'),
    WorkbenchInbox: () => import('../gtd/pages/GTDInbox'),
    WorkbenchTasks: () => import('../gtd/pages/GTDTasks'),
    WorkbenchActivity: () => import('./pages/WorkbenchActivity'),
    WorkbenchProjections: () => import('./pages/WorkbenchProjections'),
  },
};

export default manifest;
