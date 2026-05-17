import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'planning',
  name: 'Planning',
  version: '1.0.0',
  source: 'core',
  instances: ['core'],

  navGroups: [],

  routes: [
    // Brain (保留，不属于 GTD)
    {
      path: '/brain',
      component: 'BrainDashboard',
      navItem: { label: 'Brain', icon: 'Brain', group: 'execution', order: 0 },
    },
    // OKR → 重定向到 GTD
    { path: '/okr', redirect: '/gtd/okr' },
    // OKR 全树视图
    { path: '/okr/tree', component: 'OKRTreePage' },
    // Tasks → 重定向到 GTD
    { path: '/tasks', redirect: '/gtd/tasks' },
    // Projects → 重定向到 GTD
    { path: '/projects', redirect: '/gtd/projects' },
    { path: '/projects/compare', component: 'ProjectCompare' },
    { path: '/projects/:projectId', component: 'ProjectDetail' },
    // Initiatives (Three-layer decomposition)
    { path: '/initiatives/:id', component: 'InitiativeDetail' },
    // Planner (PlannerOverview removed — use CommandCenter)
    { path: '/planner', redirect: '/dashboard/command' },
    { path: '/scheduler', component: 'Scheduler' },
    { path: '/today', component: 'TodayPlan' },
    { path: '/roadmap', component: 'RoadmapPage' },
    // Canvas removed — use ProjectPanorama
    { path: '/canvas', redirect: '/work/project-panorama' },
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
    { path: '/ops/planner', redirect: '/dashboard/command' },
    { path: '/ops/scheduler', redirect: '/scheduler' },
    { path: '/ops/roadmap', redirect: '/roadmap' },
    { path: '/ops/panorama', redirect: '/panorama' },
    { path: '/ops/panorama/canvas', redirect: '/work/project-panorama' },
    { path: '/ops/panorama/whiteboard', redirect: '/whiteboard' },
    { path: '/ops/panorama/project', redirect: '/project-panorama' },
  ],

  components: {
    BrainDashboard: () => import('./pages/BrainDashboard'),
    OKRPage: () => import('./pages/OKRPage'),
    OKRTreePage: () => import('./pages/OKRTreePage'),
    Tasks: () => import('./pages/Tasks'),
    CompanyTasks: () => import('./pages/Tasks'),
    ProjectsDashboard: () => import('./pages/ProjectsDashboard'),
    ProjectCompare: () => import('./pages/ProjectCompare'),
    ProjectDetail: () => import('./pages/ProjectDetail'),
    InitiativeDetail: () => import('./pages/InitiativeDetail'),
    Scheduler: () => import('./pages/Scheduler'),
    TodayPlan: () => import('./components/TodayPlan'),
    RoadmapView: () => import('./pages/RoadmapView'),
    RoadmapPage: () => import('./pages/RoadmapPage'),
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
