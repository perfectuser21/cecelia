import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'cecelia',
  name: 'Cecelia',
  version: '1.3.0',
  source: 'core',
  instances: ['core'],

  navGroups: [
    { id: 'cecelia', label: '', icon: 'Brain', order: 0.5 },
  ],

  routes: [
    {
      path: '/cecelia',
      component: 'CeceliaPage',
      navItem: {
        label: 'Cecelia',
        icon: 'Brain',
        group: 'cecelia',
        children: [
          { path: '/cecelia/chat', label: '意识', icon: 'Eye', order: 1 },
          { path: '/cecelia/diary', label: '日记', icon: 'BookOpen', order: 2 },
          { path: '/cecelia/growth', label: '成长档案', icon: 'Sprout', order: 3 },
        ],
      },
    },
    { path: '/cecelia/chat', component: 'ConsciousnessChat' },
    { path: '/cecelia/diary', component: 'DiaryPage' },
    { path: '/cecelia/growth', component: 'GrowthProfilePage' },
    { path: '/cecelia/config', redirect: '/system/team' },
  ],

  components: {
    CeceliaPage: () => import('./pages/CeceliaPage'),
    ConsciousnessChat: () => import('./pages/ConsciousnessChat'),
    DiaryPage: () => import('./pages/DiaryPage'),
    GrowthProfilePage: () => import('./pages/GrowthProfilePage'),
  },
};

export default manifest;
