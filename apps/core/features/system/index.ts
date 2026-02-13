import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'system',
  name: 'System',
  version: '1.0.0',
  source: 'core',
  instances: ['core'],

  navGroups: [
    { id: 'system', label: '系统', order: 4 },
  ],

  routes: [
    // Ops Center
    {
      path: '/ops/live',
      component: 'LiveDashboard',
      navItem: { label: 'Live', icon: 'Activity', group: 'system', order: 1 },
    },
    // VPS Monitor
    {
      path: '/vps-monitor',
      component: 'VpsMonitor',
      navItem: { label: 'VPS', icon: 'Server', group: 'system', order: 2 },
    },
    { path: '/ops/system/vps', redirect: '/vps-monitor' },
    // Claude Monitor
    {
      path: '/claude-monitor',
      component: 'ClaudeMonitor',
      navItem: { label: 'Claude', icon: 'Bot', group: 'system', order: 3 },
    },
    { path: '/claude-stats', component: 'ClaudeStats' },
    { path: '/ops/claude', redirect: '/claude-monitor' },
    { path: '/ops/claude/stats', redirect: '/claude-stats' },
    // Quality
    {
      path: '/quality',
      component: 'QualityMonitorPage',
      navItem: { label: '质量监控', icon: 'Shield', group: 'system', order: 4 },
    },
    // DevGate
    {
      path: '/devgate',
      component: 'DevGateMetrics',
      navItem: { label: 'DevGate', icon: 'GitBranch', group: 'system', order: 5 },
    },
    { path: '/ops/devgate', redirect: '/devgate' },
    // Performance
    { path: '/performance', component: 'PerformanceMonitoring' },
  ],

  components: {
    LiveDashboard: () => import('./pages/LiveDashboard'),
    VpsMonitor: () => import('./pages/VpsMonitor'),
    ClaudeMonitor: () => import('./pages/ClaudeMonitor'),
    ClaudeStats: () => import('./pages/ClaudeStats'),
    QualityMonitorPage: () => import('./pages/QualityMonitorPage'),
    DevGateMetrics: () => import('./pages/DevGateMetrics'),
    PerformanceMonitoring: () => import('./pages/PerformanceMonitoring'),
    FeatureMap: () => import('./pages/FeatureMap'),
  },
};

export default manifest;
