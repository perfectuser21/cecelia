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
    {
      path: '/work',
      component: 'WorkHome',
      navItem: { label: 'Work', icon: 'Briefcase', group: 'work' },
    },
    { path: '/work/projects', component: 'ProjectsDashboard' },
    { path: '/work/projects/:projectId', component: 'ProjectDetail' },
    { path: '/work/tasks', component: 'TasksPage' },
    { path: '/work/okr', component: 'OKRPage' },
    { path: '/work/roadmap', component: 'RoadmapView' },
    { path: '/work/dev-tasks', component: 'DevTasks' },
    { path: '/work/project-panorama', component: 'ProjectPanorama' },
    { path: '/work/features', component: 'FeatureDashboard' },
    { path: '/work/whiteboard', component: 'Whiteboard' },
    // Legacy redirects
    { path: '/work/panorama', redirect: '/dashboard/panorama' },
    { path: '/tasks', redirect: '/work/tasks' },
    { path: '/projects', redirect: '/work/projects' },
    { path: '/okr', redirect: '/work/okr' },
    { path: '/roadmap', redirect: '/work/roadmap' },
    { path: '/whiteboard', redirect: '/work/whiteboard' },
    { path: '/portfolio', redirect: '/work/projects' },
    { path: '/company', redirect: '/work/projects' },
    { path: '/company/tasks', redirect: '/work/tasks' },
    { path: '/company/media', redirect: '/work/projects' },
    { path: '/company/team', redirect: '/work/projects' },
    { path: '/company/finance', redirect: '/work/projects' },
  ],

  components: {
    WorkHome: () => import('./pages/WorkHome'),
    ProjectsDashboard: () => import('../planning/pages/ProjectsDashboard'),
    ProjectDetail: () => import('../planning/pages/ProjectDetail'),
    TasksPage: () => import('../planning/pages/Tasks'),
    OKRPage: () => import('../planning/pages/OKRPage'),
    RoadmapView: () => import('../planning/pages/RoadmapView'),
    DevTasks: () => import('../execution/pages/DevTasks'),
    ProjectPanorama: () => import('../planning/pages/ProjectPanorama'),
    FeatureDashboard: () => import('../shared/pages/FeatureDashboard'),
    Whiteboard: () => import('../planning/pages/Whiteboard'),
  },
};

export default manifest;
