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
    { path: '/system/planner', component: 'PlannerOverview' },
    { path: '/system/cecelia', component: 'CeceliaOverview' },
    { path: '/system/cecelia/runs', component: 'CeceliaRuns' },
    { path: '/system/cecelia/runs/:runId', component: 'RunDetail' },
    { path: '/system/cecelia/agents/:agentId', component: 'AgentDetail' },
    // Engine
    { path: '/system/engine', component: 'EngineDashboard' },
    { path: '/system/engine/capabilities', component: 'EngineCapabilities' },
    { path: '/system/brain', component: 'BrainDashboard' },
    { path: '/system/orchestrator', component: 'OrchestratorPage' },
    // N8N
    { path: '/system/n8n/workflows', component: 'N8nWorkflows' },
    { path: '/system/n8n/workflows/:instance/:id', component: 'N8nWorkflowDetail' },
    { path: '/system/n8n/live-status', component: 'N8nLiveStatus' },
    { path: '/system/n8n/live-status/:instance/:executionId', component: 'N8nLiveStatusDetail' },
    // Workers
    { path: '/system/workers', component: 'WorkersOverview' },
    { path: '/system/session-monitor', component: 'SessionMonitor' },
    // Monitoring
    { path: '/system/vps-monitor', component: 'VpsMonitor' },
    { path: '/system/performance', component: 'PerformanceMonitoring' },
    { path: '/system/claude-monitor', component: 'ClaudeMonitor' },
    { path: '/system/claude-stats', component: 'ClaudeStats' },
    { path: '/system/quality', component: 'QualityMonitorPage' },
    { path: '/system/devgate', component: 'DevGateMetrics' },
    { path: '/system/live', component: 'LiveDashboard' },
    // Panorama
    { path: '/system/canvas', component: 'Canvas' },
    { path: '/system/project-panorama', component: 'ProjectPanorama' },
    { path: '/system/panorama', component: 'DevPanorama' },
    { path: '/system/panorama/repo/:repoName', component: 'RepoDetail' },
    // Legacy redirects
    { path: '/cecelia', redirect: '/system/cecelia' },
    { path: '/cecelia/runs', redirect: '/system/cecelia/runs' },
    { path: '/engine', redirect: '/system/engine' },
    { path: '/engine/capabilities', redirect: '/system/engine/capabilities' },
    { path: '/engine/dev-tasks', redirect: '/work/dev-tasks' },
    { path: '/engine/session-monitor', redirect: '/system/session-monitor' },
    { path: '/brain', redirect: '/system/brain' },
    { path: '/orchestrator', redirect: '/system/orchestrator' },
    { path: '/n8n/workflows', redirect: '/system/n8n/workflows' },
    { path: '/n8n/live-status', redirect: '/system/n8n/live-status' },
    { path: '/workers', redirect: '/system/workers' },
    { path: '/planner', redirect: '/system/planner' },
    { path: '/panorama', redirect: '/system/panorama' },
    { path: '/canvas', redirect: '/system/canvas' },
    { path: '/project-panorama', redirect: '/system/project-panorama' },
    { path: '/vps-monitor', redirect: '/system/vps-monitor' },
    { path: '/performance', redirect: '/system/performance' },
    { path: '/claude-monitor', redirect: '/system/claude-monitor' },
    { path: '/claude-stats', redirect: '/system/claude-stats' },
    { path: '/quality', redirect: '/system/quality' },
    { path: '/devgate', redirect: '/system/devgate' },
    // Legacy /ops redirects
    { path: '/ops', redirect: '/dashboard' },
    { path: '/ops/live', redirect: '/system/live' },
    { path: '/ops/cecelia', redirect: '/system/cecelia' },
    { path: '/ops/cecelia/runs', redirect: '/system/cecelia/runs' },
    { path: '/ops/system/engine', redirect: '/system/engine' },
    { path: '/ops/system/capabilities', redirect: '/system/engine/capabilities' },
    { path: '/ops/system/dev-tasks', redirect: '/work/dev-tasks' },
    { path: '/ops/system/session-monitor', redirect: '/system/session-monitor' },
    { path: '/ops/planner', redirect: '/system/planner' },
    { path: '/ops/planning', redirect: '/system/planner' },
    { path: '/ops/scheduler', redirect: '/today/scheduler' },
    { path: '/ops/roadmap', redirect: '/work/roadmap' },
    { path: '/ops/panorama', redirect: '/system/panorama' },
    { path: '/ops/panorama/canvas', redirect: '/system/canvas' },
    { path: '/ops/panorama/whiteboard', redirect: '/work/whiteboard' },
    { path: '/ops/panorama/project', redirect: '/system/project-panorama' },
    { path: '/ops/system', redirect: '/system/vps-monitor' },
    { path: '/ops/system/vps', redirect: '/system/vps-monitor' },
    { path: '/ops/claude', redirect: '/system/claude-monitor' },
    { path: '/ops/claude/stats', redirect: '/system/claude-stats' },
    { path: '/ops/devgate', redirect: '/system/devgate' },
    { path: '/planning', redirect: '/system/planner' },
    { path: '/company/ai-team', redirect: '/system/workers' },
    { path: '/company/ai-team/workers', redirect: '/system/workers' },
    { path: '/company/ai-team/workflows', redirect: '/system/n8n/workflows' },
    { path: '/company/ai-team/live-status', redirect: '/system/n8n/live-status' },
  ],

  components: {
    SystemHome: () => import('./pages/SystemHome'),
    // Cecelia
    PlannerOverview: () => import('../planning/pages/PlannerOverview'),
    CeceliaOverview: () => import('../execution/pages/CeceliaOverview'),
    CeceliaRuns: () => import('../execution/pages/CeceliaRuns'),
    RunDetail: () => import('../execution/pages/RunDetail'),
    AgentDetail: () => import('../execution/pages/AgentDetail'),
    // Engine
    EngineDashboard: () => import('../execution/pages/EngineDashboard'),
    EngineCapabilities: () => import('../execution/pages/EngineCapabilities'),
    BrainDashboard: () => import('../planning/pages/BrainDashboard'),
    OrchestratorPage: () => import('../execution/pages/OrchestratorPage'),
    // N8N
    N8nWorkflows: () => import('../execution/pages/N8nWorkflows'),
    N8nWorkflowDetail: () => import('../execution/pages/N8nWorkflowDetail'),
    N8nLiveStatus: () => import('../execution/pages/N8nLiveStatus'),
    N8nLiveStatusDetail: () => import('../execution/pages/N8nLiveStatusDetail'),
    // Workers
    WorkersOverview: () => import('../execution/pages/WorkersOverview'),
    SessionMonitor: () => import('../execution/pages/SessionMonitor'),
    // Monitoring
    VpsMonitor: () => import('../system/pages/VpsMonitor'),
    PerformanceMonitoring: () => import('../system/pages/PerformanceMonitoring'),
    ClaudeMonitor: () => import('../system/pages/ClaudeMonitor'),
    ClaudeStats: () => import('../system/pages/ClaudeStats'),
    QualityMonitorPage: () => import('../system/pages/QualityMonitorPage'),
    DevGateMetrics: () => import('../system/pages/DevGateMetrics'),
    LiveDashboard: () => import('../system/pages/LiveDashboard'),
    // Panorama
    Canvas: () => import('../planning/pages/Canvas'),
    ProjectPanorama: () => import('../planning/pages/ProjectPanorama'),
    DevPanorama: () => import('../planning/pages/DevPanorama'),
    RepoDetail: () => import('../planning/pages/RepoDetail'),
  },
};

export default manifest;
