import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'work',
  name: 'Work',
  version: '1.1.0',
  source: 'core',
  instances: ['core'],

  // Work 导航组已被 GTD System 取代
  navGroups: [],

  routes: [
    // 所有 /work/* 路由重定向到 /gtd/*
    { path: '/work', redirect: '/gtd/area' },
    { path: '/work/okr', redirect: '/gtd/okr' },
    { path: '/work/projects', redirect: '/gtd/projects' },
    { path: '/work/tasks', redirect: '/gtd/tasks' },
    { path: '/work/roadmap', component: 'RoadmapView' },
    { path: '/work/streams', component: 'WorkStreams' },
    // Drill-down routes (保留)
    { path: '/work/projects/:projectId', component: 'ProjectDetail' },
    { path: '/work/project-panorama', component: 'ProjectPanorama' },
    { path: '/work/whiteboard', component: 'Whiteboard' },
    { path: '/work/okr/area/:areaId', component: 'AreaOKRDetail' },
    // Legacy redirects
    { path: '/work/dev-tasks', redirect: '/gtd/tasks' },
    { path: '/work/panorama', redirect: '/dashboard/panorama' },
    { path: '/tasks', redirect: '/gtd/tasks' },
    { path: '/projects', redirect: '/gtd/projects' },
    { path: '/okr', redirect: '/gtd/okr' },
    { path: '/roadmap', redirect: '/work/roadmap' },
    { path: '/whiteboard', redirect: '/work/whiteboard' },
    { path: '/portfolio', redirect: '/gtd/area' },
    { path: '/company', redirect: '/gtd/area' },
    { path: '/company/tasks', redirect: '/today/schedule' },
    { path: '/company/media', redirect: '/gtd/area' },
    { path: '/company/team', redirect: '/gtd/area' },
    { path: '/company/finance', redirect: '/gtd/area' },
  ],

  components: {
    WorkStreams: () => import('./pages/WorkStreams'),
    RoadmapView: () => import('../planning/pages/RoadmapView'),
    ProjectDetail: () => import('../planning/pages/ProjectDetail'),
    ProjectPanorama: () => import('../planning/pages/ProjectPanorama'),
    Whiteboard: () => import('../planning/pages/Whiteboard'),
    AreaOKRDetail: () => import('../planning/pages/AreaOKRDetail'),
  },
};

export default manifest;
