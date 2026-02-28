import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'cecelia',
  name: 'Cecelia',
  version: '1.3.0',
  source: 'core',
  instances: ['core'],

  navGroups: [
    { id: 'cecelia', label: 'Cecelia', icon: 'Brain', order: 0.5 },
  ],

  routes: [
    {
      path: '/cecelia',
      component: 'CeceliaPage',
      navItem: {
        label: '主页',
        icon: 'LayoutDashboard',
        group: 'cecelia',
        order: 1,
      },
    },
    {
      path: '/cecelia/chat',
      component: 'ConsciousnessChat',
      navItem: {
        label: '意识',
        icon: 'Eye',
        group: 'cecelia',
        order: 2,
      },
    },
    {
      path: '/cecelia/diary',
      component: 'DiaryPage',
      navItem: {
        label: '日记',
        icon: 'BookOpen',
        group: 'cecelia',
        order: 3,
      },
    },
    {
      path: '/cecelia/growth',
      component: 'GrowthProfilePage',
      navItem: {
        label: '成长档案',
        icon: 'Sprout',
        group: 'cecelia',
        order: 4,
      },
    },
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
