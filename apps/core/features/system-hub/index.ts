import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'system-hub',
  name: 'System',
  version: '1.0.0',
  source: 'core',
  instances: ['core'],

  navGroups: [
    { id: 'system', label: 'System', icon: 'Monitor', order: 5 },
  ],

  routes: [
    // Main entry
    {
      path: '/system',
      component: 'SystemHome',
      navItem: { label: 'System', icon: 'Monitor', group: 'system' },
    },
    // Cecelia
    { path: '/system/cecelia', component: 'CeceliaOverview' },
    { path: '/system/cecelia/runs', component: 'CeceliaRuns' },
    { path: '/system/cecelia/runs/:runId', component: 'RunDetail' },
    { path: '/system/cecelia/agents/:agentId', component: 'AgentDetail' },
    // Engine
    { path: '/system/engine', component: 'EngineDashboard' },
    { path: '/system/engine/capabilities', component: 'EngineCapabilities' },
    { path: '/system/brain', component: 'BrainDashboard' },
    // N8N
    { path: '/system/n8n/workflows', component: 'N8nWorkflows' },
    { path: '/system/n8n/workflows/:instance/:id', component: 'N8nWorkflowDetail' },
    { path: '/system/n8n/live-status', component: 'N8nLiveStatus' },
    { path: '/system/n8n/live-status/:instance/:executionId', component: 'N8nLiveStatusDetail' },
    // Workers
    { path: '/system/workers', component: 'WorkersOverview' },
    { path: '/system/session-monitor', component: 'SessionMonitor' },
    // Monitoring
    { path: '/system/infrastructure', component: 'InfrastructureMonitor' },
    { path: '/system/claude', component: 'ClaudeMonitor' },
    { path: '/system/operations', component: 'OperationsMonitor' },
    { path: '/system/devgate', component: 'DevGateMetrics' },
    // Panorama
    { path: '/system/panorama', component: 'DevPanorama' },
    { path: '/system/panorama/repo/:repoName', component: 'RepoDetail' },
    // Removed pages → redirects
    { path: '/system/planner', redirect: '/dashboard/command' },
    { path: '/system/orchestrator', redirect: '/system/brain' },
    { path: '/system/canvas', redirect: '/work/project-panorama' },
    { path: '/system/project-panorama', redirect: '/work/project-panorama' },
    { path: '/system/vps-monitor', redirect: '/system/infrastructure' },
    { path: '/system/performance', redirect: '/system/infrastructure' },
    { path: '/system/claude-monitor', redirect: '/system/claude' },
    { path: '/system/claude-stats', redirect: '/system/claude' },
    { path: '/system/quality', redirect: '/system/operations' },
    { path: '/system/live', redirect: '/system/operations' },
    // Legacy short-form redirects
    { path: '/cecelia', redirect: '/system/cecelia' },
    { path: '/cecelia/runs', redirect: '/system/cecelia/runs' },
    { path: '/engine', redirect: '/system/engine' },
    { path: '/engine/capabilities', redirect: '/system/engine/capabilities' },
    { path: '/engine/dev-tasks', redirect: '/work/dev-tasks' },
    { path: '/engine/session-monitor', redirect: '/system/session-monitor' },
    { path: '/brain', redirect: '/system/brain' },
    { path: '/orchestrator', redirect: '/system/brain' },
    { path: '/n8n/workflows', redirect: '/system/n8n/workflows' },
    { path: '/n8n/live-status', redirect: '/system/n8n/live-status' },
    { path: '/workers', redirect: '/system/workers' },
    { path: '/planner', redirect: '/dashboard/command' },
    { path: '/panorama', redirect: '/system/panorama' },
    { path: '/canvas', redirect: '/work/project-panorama' },
    { path: '/project-panorama', redirect: '/work/project-panorama' },
    { path: '/vps-monitor', redirect: '/system/infrastructure' },
    { path: '/performance', redirect: '/system/infrastructure' },
    { path: '/claude-monitor', redirect: '/system/claude' },
    { path: '/claude-stats', redirect: '/system/claude' },
    { path: '/quality', redirect: '/system/operations' },
    { path: '/devgate', redirect: '/system/devgate' },
    // Legacy /ops redirects
    { path: '/ops', redirect: '/dashboard' },
    { path: '/ops/live', redirect: '/system/operations' },
    { path: '/ops/cecelia', redirect: '/system/cecelia' },
    { path: '/ops/cecelia/runs', redirect: '/system/cecelia/runs' },
    { path: '/ops/system/engine', redirect: '/system/engine' },
    { path: '/ops/system/capabilities', redirect: '/system/engine/capabilities' },
    { path: '/ops/system/dev-tasks', redirect: '/work/dev-tasks' },
    { path: '/ops/system/session-monitor', redirect: '/system/session-monitor' },
    { path: '/ops/planner', redirect: '/dashboard/command' },
    { path: '/ops/planning', redirect: '/dashboard/command' },
    { path: '/ops/scheduler', redirect: '/today/scheduler' },
    { path: '/ops/roadmap', redirect: '/work/roadmap' },
    { path: '/ops/panorama', redirect: '/system/panorama' },
    { path: '/ops/panorama/canvas', redirect: '/work/project-panorama' },
    { path: '/ops/panorama/whiteboard', redirect: '/work/whiteboard' },
    { path: '/ops/panorama/project', redirect: '/work/project-panorama' },
    { path: '/ops/system', redirect: '/system/infrastructure' },
    { path: '/ops/system/vps', redirect: '/system/infrastructure' },
    { path: '/ops/claude', redirect: '/system/claude' },
    { path: '/ops/claude/stats', redirect: '/system/claude' },
    { path: '/ops/devgate', redirect: '/system/devgate' },
    { path: '/planning', redirect: '/dashboard/command' },
    { path: '/company/ai-team', redirect: '/system/workers' },
    { path: '/company/ai-team/workers', redirect: '/system/workers' },
    { path: '/company/ai-team/workflows', redirect: '/system/n8n/workflows' },
    { path: '/company/ai-team/live-status', redirect: '/system/n8n/live-status' },
  ],

  components: {
    SystemHome: () => import('./pages/SystemHome'),
    // Cecelia
    CeceliaOverview: () => import('../execution/pages/CeceliaOverview'),
    CeceliaRuns: () => import('../execution/pages/CeceliaRuns'),
    RunDetail: () => import('../execution/pages/RunDetail'),
    AgentDetail: () => import('../execution/pages/AgentDetail'),
    // Engine
    EngineDashboard: () => import('../execution/pages/EngineDashboard'),
    EngineCapabilities: () => import('../execution/pages/EngineCapabilities'),
    BrainDashboard: () => import('../planning/pages/BrainDashboard'),
    // N8N
    N8nWorkflows: () => import('../execution/pages/N8nWorkflows'),
    N8nWorkflowDetail: () => import('../execution/pages/N8nWorkflowDetail'),
    N8nLiveStatus: () => import('../execution/pages/N8nLiveStatus'),
    N8nLiveStatusDetail: () => import('../execution/pages/N8nLiveStatusDetail'),
    // Workers
    WorkersOverview: () => import('../execution/pages/WorkersOverview'),
    SessionMonitor: () => import('../execution/pages/SessionMonitor'),
    // Monitoring (merged)
    InfrastructureMonitor: () => import('../system/pages/InfrastructureMonitor'),
    ClaudeMonitor: () => import('../system/pages/ClaudeMonitor'),
    OperationsMonitor: () => import('../system/pages/OperationsMonitor'),
    DevGateMetrics: () => import('../system/pages/DevGateMetrics'),
    // Panorama
    DevPanorama: () => import('../planning/pages/DevPanorama'),
    RepoDetail: () => import('../planning/pages/RepoDetail'),
  },
};

export default manifest;
