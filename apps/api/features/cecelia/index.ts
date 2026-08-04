import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  name: 'Cecelia',
  id: 'cecelia',
  version: '1.4.0',
  source: 'core',
  instances: ['core'],

  navGroups: [],

  routes: [
    {
      path: '/cecelia',
      component: 'CeceliaPage',
      navItem: {
        label: 'Cecelia',
        icon: 'Brain',
        group: 'system',
        children: [
          { path: '/cecelia/chat', label: '意识', icon: 'Eye', order: 1 },
          { path: '/cecelia/diary', label: '日记', icon: 'BookOpen', order: 2 },
          { path: '/cecelia/growth', label: '成长档案', icon: 'Sprout', order: 3 },
          { path: '/cecelia/evolution', label: '进化日志', icon: 'TrendingUp', order: 4 },
          { path: '/ledger', label: '11要素账本', icon: 'ClipboardList', order: 5 },
        ],
      },
    },
    { path: '/cecelia/chat', component: 'ConsciousnessChat' },
    { path: '/cecelia/diary', component: 'DiaryPage' },
    { path: '/cecelia/growth', component: 'GrowthProfilePage' },
    { path: '/cecelia/evolution', component: 'EvolutionPage' },
    { path: '/cecelia/ledger', redirect: '/ledger' },
    { path: '/cecelia/config', redirect: '/system/team' },
  ],

  components: {
    CeceliaPage: () => import('./pages/CeceliaPage'),
    ConsciousnessChat: () => import('./pages/ConsciousnessChat'),
    DiaryPage: () => import('./pages/DiaryPage'),
    GrowthProfilePage: () => import('./pages/GrowthProfilePage'),
    EvolutionPage: () => import('./pages/EvolutionPage'),
  },
};

export default manifest;
