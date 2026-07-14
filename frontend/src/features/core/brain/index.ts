import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'brain',
  name: 'Brain',
  version: '1.0.0',
  source: 'core',
  instances: ['core'],

  navGroups: [
    { id: 'brain', label: '系统监控', icon: 'Brain', order: 10 },
  ],

  routes: [
    {
      path: '/cecelia',
      component: 'CeceliaOverview',
      navItem: { label: 'Cecelia 总览', icon: 'Brain', group: 'brain', order: 1 },
    },
    {
      path: '/server/:serverId',
      component: 'ServerDetail',
      // 无 navItem，不在菜单显示
    },
    {
      path: '/seats',
      component: 'SeatsStatus',
      navItem: { label: 'Seats 详情', icon: 'Monitor', group: 'brain', order: 2 },
    },
    {
      path: '/llm-observability',
      component: 'LangfuseObservability',
      navItem: { label: 'LLM 观测', icon: 'Activity', group: 'brain', order: 3 },
    },
    {
      path: '/ledger',
      component: 'LedgerPage',
      navItem: { label: '11要素账本', icon: 'BookOpen', group: 'brain', order: 4 },
    },
  ],

  components: {
    CeceliaOverview: () => import('./pages/CeceliaOverview'),
    ServerDetail: () => import('./pages/ServerDetail'),
    SeatsStatus: () => import('./pages/SeatsStatus'),
    LangfuseObservability: () => import('./pages/LangfuseObservability'),
    LedgerPage: () => import('./pages/LedgerPage'),
  },
};

export default manifest;
