import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'cecelia',
  name: 'Cecelia',
  version: '1.1.0',
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
        label: '对话',
        icon: 'MessageSquare',
        group: 'cecelia',
        order: 1,
      },
    },
    { path: '/cecelia/config', redirect: '/system/team' },
  ],

  components: {
    CeceliaPage: () => import('./pages/CeceliaPage'),
  },
};

export default manifest;
