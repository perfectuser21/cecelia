import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'work',
  name: 'Work',
  version: '1.0.0',
  source: 'core',
  instances: ['core'],

  navGroups: [
    { id: 'work', label: 'Work', icon: 'Briefcase', order: 3 },
  ],

  routes: [
    // Tab routes
    {
      path: '/work',
      component: 'WorkTabbed',
      navItem: {
        label: 'Work', icon: 'Briefcase', group: 'work',
        children: [
          { path: '/work', label: 'Projects', icon: 'FolderKanban', order: 1 },
          { path: '/work/okr', label: 'OKR', icon: 'Target', order: 2 },
          { path: '/work/tasks', label: 'Tasks', icon: 'ListTodo', order: 3 },
          { path: '/work/roadmap', label: 'Roadmap', icon: 'Map', order: 4 },
          { path: '/work/features', label: 'Features', icon: 'Layers', order: 5 },
        ],
      },
    },
    { path: '/work/okr', component: 'WorkTabbed' },
    { path: '/work/tasks', component: 'WorkTabbed' },
    { path: '/work/roadmap', component: 'WorkTabbed' },
    { path: '/work/features', component: 'WorkTabbed' },
    // Drill-down routes
    { path: '/work/projects/:projectId', component: 'ProjectDetail' },
    { path: '/work/project-panorama', component: 'ProjectPanorama' },
    { path: '/work/whiteboard', component: 'Whiteboard' },
    { path: '/work/okr/area/:areaId', component: 'AreaDetail' },
    // Redirects from old paths
    { path: '/work/projects', redirect: '/work' },
    // /work/tasks is now a real tab route (WorkTabbed handles it)
    { path: '/work/dev-tasks', redirect: '/work' },
    // Legacy redirects
    { path: '/work/panorama', redirect: '/dashboard/panorama' },
    { path: '/tasks', redirect: '/work/tasks' },
    { path: '/projects', redirect: '/work' },
    { path: '/okr', redirect: '/work/okr' },
    { path: '/roadmap', redirect: '/work/roadmap' },
    { path: '/whiteboard', redirect: '/work/whiteboard' },
    { path: '/portfolio', redirect: '/work' },
    { path: '/company', redirect: '/work' },
    { path: '/company/tasks', redirect: '/today/schedule' },
    { path: '/company/media', redirect: '/work' },
    { path: '/company/team', redirect: '/work' },
    { path: '/company/finance', redirect: '/work' },
  ],

  components: {
    WorkTabbed: () => import('./pages/WorkTabbed'),
    ProjectDetail: () => import('../planning/pages/ProjectDetail'),
    ProjectPanorama: () => import('../planning/pages/ProjectPanorama'),
    Whiteboard: () => import('../planning/pages/Whiteboard'),
    AreaDetail: () => import('../planning/pages/AreaDetail'),
  },
};

export default manifest;
