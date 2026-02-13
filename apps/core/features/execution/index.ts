import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'execution',
  name: 'Execution',
  version: '1.0.0',
  source: 'core',
  instances: ['core'],

  navGroups: [
    { id: 'execution', label: '执行', order: 3 },
  ],

  routes: [
    // Brain Status Dashboard
    { path: '/brain-status', component: 'BrainStatusDashboard' },
    // Observability Dashboard
    { path: '/observability', component: 'ObservabilityDashboard' },
    // Cecelia
    { path: '/cecelia', component: 'CeceliaOverview' },
    { path: '/cecelia/agents/:agentId', component: 'AgentDetail' },
    { path: '/cecelia/runs', component: 'CeceliaRuns' },
    { path: '/cecelia/runs/:runId', component: 'RunDetail' },
    // Engine
    { path: '/engine', component: 'EngineDashboard' },
    { path: '/engine/capabilities', component: 'EngineCapabilities' },
    { path: '/engine/dev-tasks', component: 'DevTasks' },
    { path: '/engine/session-monitor', component: 'SessionMonitor' },
    // N8N
    { path: '/n8n/workflows', component: 'N8nWorkflows' },
    { path: '/n8n/workflows/:instance/:id', component: 'N8nWorkflowDetail' },
    { path: '/n8n/live-status', component: 'N8nLiveStatus' },
    { path: '/n8n/live-status/:instance/:executionId', component: 'N8nLiveStatusDetail' },
    // Workers
    {
      path: '/workers',
      component: 'WorkersOverview',
    },
    // Orchestrator removed — use BrainDashboard
    { path: '/orchestrator', redirect: '/brain' },
    // Redirects from old /ops/* paths
    { path: '/ops/cecelia', redirect: '/cecelia' },
    { path: '/ops/cecelia/runs', redirect: '/cecelia/runs' },
    { path: '/ops/system/engine', redirect: '/engine' },
    { path: '/ops/system/capabilities', redirect: '/engine/capabilities' },
    { path: '/ops/system/dev-tasks', redirect: '/engine/dev-tasks' },
    { path: '/ops/system/session-monitor', redirect: '/engine/session-monitor' },
  ],

  components: {
    BrainStatusDashboard: () => import('./pages/BrainStatusDashboard'),
    ObservabilityDashboard: () => import('../../../dashboard/src/pages/ObservabilityDashboard'),
    CeceliaOverview: () => import('./pages/CeceliaOverview'),
    AgentDetail: () => import('./pages/AgentDetail'),
    CeceliaRuns: () => import('./pages/CeceliaRuns'),
    RunDetail: () => import('./pages/RunDetail'),
    EngineDashboard: () => import('./pages/EngineDashboard'),
    EngineCapabilities: () => import('./pages/EngineCapabilities'),
    DevTasks: () => import('./pages/DevTasks'),
    SessionMonitor: () => import('./pages/SessionMonitor'),
    N8nWorkflows: () => import('./pages/N8nWorkflows'),
    N8nWorkflowDetail: () => import('./pages/N8nWorkflowDetail'),
    N8nLiveStatus: () => import('./pages/N8nLiveStatus'),
    N8nLiveStatusDetail: () => import('./pages/N8nLiveStatusDetail'),
    WorkersOverview: () => import('./pages/WorkersOverview'),
  },
};

export default manifest;

// Re-export workers utilities for cross-domain use
export * from './config/workers.types';
export { getDepartments, getAllWorkers, getWorkerById, getWorkerKeywords, matchWorkerByWorkflowName, getConfigVersion, getStats } from './config/workers.config';
export { getWorkersData, getWorkerDetail, getWorkerWorkflows, findWorkerByWorkflowName } from './config/workers.service';
export { workersApi } from './api/workers.api';
