import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'okr',
  name: 'OKR Dashboard',
  version: '1.0.0',
  source: 'core',
  instances: ['core'],

  routes: [
    {
      path: '/okr',
      component: 'OKRPage',
      navItem: {
        label: 'OKR',
        icon: 'Target',
        group: 'ops',
        order: 16,
      },
    },
  ],

  components: {
    OKRPage: () => import('./pages/OKRPage'),
  },
};

export default manifest;
