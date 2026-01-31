import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'knowledge',
  name: 'Knowledge',
  version: '1.0.0',
  source: 'core',
  instances: ['core'],

  routes: [
    {
      path: '/knowledge',
      component: 'KnowledgeDashboard',
    },
  ],

  components: {
    KnowledgeDashboard: () => import('./pages/KnowledgeDashboard'),
  },
};

export default manifest;
