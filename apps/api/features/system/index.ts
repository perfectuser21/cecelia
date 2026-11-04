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
    { path: '/website-functions', component: 'WebsiteFunctionsPage' },
    // 旧系统路径统一由system-hub持有并跳转到当前系统页。
    // Langfuse Traces
    {
      path: '/traces',
      component: 'TracesPage',
      navItem: { label: 'Traces', icon: 'Activity', group: 'system', order: 6 },
    },
    // Machines Dashboard
    {
      path: '/machines',
      component: 'MachinesPage',
      navItem: { label: '设备', icon: 'Server', group: 'system', order: 99 },
    },
    { path: '/machines/:name', component: 'MachineDetailPage' },
    // 11要素账本
    {
      path: '/ledger',
      component: 'LedgerPage',
      navItem: { label: '11要素账本', icon: 'BookOpen', group: 'system', order: 7 },
    },
  ],

  components: {
    WebsiteFunctionsPage: () => import('./pages/website-functions/WebsiteFunctionsPage'),
    FeatureMap: () => import('./pages/FeatureMap'),
    TracesPage: () => import('./pages/TracesPage'),
    MachinesPage: () => import('./pages/MachinesPage'),
    MachineDetailPage: () => import('./pages/MachineDetailPage'),
    LedgerPage: () => import('./pages/LedgerPage'),
  },
};

export default manifest;
