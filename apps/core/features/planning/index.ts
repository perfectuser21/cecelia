import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'planning',
  name: 'Planning',
  version: '1.0.0',
  source: 'core',
  instances: ['core'],

  navGroups: [
    { id: 'planning', label: '规划', order: 2 },
  ],

  routes: [
    // Brain
    {
      path: '/brain',
      component: 'BrainDashboard',
      navItem: { label: 'Brain', icon: 'Brain', group: 'planning', order: 1 },
    },
    // OKR
    {
      path: '/okr',
      component: 'OKRPage',
      navItem: { label: 'OKR', icon: 'Target', group: 'planning', order: 2 },
    },
    // Tasks
    { path: '/tasks', component: 'Tasks' },
    // Projects
    {
      path: '/projects',
      component: 'ProjectsDashboard',
      navItem: { label: 'Projects', icon: 'FolderKanban', group: 'planning', order: 3 },
    },
    { path: '/projects/:projectId', component: 'ProjectDetail' },
    // Planner
    { path: '/planner', component: 'PlannerOverview' },
    { path: '/scheduler', component: 'Scheduler' },
    { path: '/today', component: 'TodayPlan' },
    { path: '/roadmap', component: 'RoadmapView' },
    // Canvas
    { path: '/canvas', component: 'Canvas' },
    { path: '/whiteboard', component: 'Whiteboard' },
    { path: '/project-panorama', component: 'ProjectPanorama' },
    // Dev Panorama
    { path: '/panorama', component: 'DevPanorama' },
    { path: '/panorama/repo/:repoName', component: 'RepoDetail' },
    // Company (workers/workflows reuse execution pages)
    { path: '/company/tasks', component: 'CompanyTasks' },
    { path: '/company/ai-team/workers', component: 'CompanyWorkers' },
    { path: '/company/ai-team/workflows', component: 'CompanyWorkflows' },
    { path: '/company/ai-team/workflows/:instance/:id', component: 'CompanyWorkflowDetail' },
    { path: '/company/ai-team/live-status', component: 'CompanyLiveStatus' },
    { path: '/company/ai-team/live-status/:instance/:executionId', component: 'CompanyLiveStatusDetail' },
    // Redirects from old /ops/* paths
    { path: '/ops/planner', redirect: '/planner' },
    { path: '/ops/scheduler', redirect: '/scheduler' },
    { path: '/ops/roadmap', redirect: '/roadmap' },
    { path: '/ops/panorama', redirect: '/panorama' },
    { path: '/ops/panorama/canvas', redirect: '/canvas' },
    { path: '/ops/panorama/whiteboard', redirect: '/whiteboard' },
    { path: '/ops/panorama/project', redirect: '/project-panorama' },
  ],

  components: {
    BrainDashboard: () => import('./pages/BrainDashboard'),
    OKRPage: () => import('./pages/OKRPage'),
    Tasks: () => import('./pages/Tasks'),
    CompanyTasks: () => import('./pages/Tasks'),
    ProjectsDashboard: () => import('./pages/ProjectsDashboard'),
    ProjectDetail: () => import('./pages/ProjectDetail'),
    PlannerOverview: () => import('./pages/PlannerOverview'),
    Scheduler: () => import('./pages/Scheduler'),
    TodayPlan: () => import('./components/TodayPlan'),
    RoadmapView: () => import('./pages/RoadmapView'),
    Canvas: () => import('./pages/Canvas'),
    Whiteboard: () => import('./pages/Whiteboard'),
    ProjectPanorama: () => import('./pages/ProjectPanorama'),
    DevPanorama: () => import('./pages/DevPanorama'),
    RepoDetail: () => import('./pages/RepoDetail'),
    CompanyWorkers: () => import('../execution/pages/WorkersOverview'),
    CompanyWorkflows: () => import('../execution/pages/N8nWorkflows'),
    CompanyWorkflowDetail: () => import('../execution/pages/N8nWorkflowDetail'),
    CompanyLiveStatus: () => import('../execution/pages/N8nLiveStatus'),
    CompanyLiveStatusDetail: () => import('../execution/pages/N8nLiveStatusDetail'),
  },
};

export default manifest;
