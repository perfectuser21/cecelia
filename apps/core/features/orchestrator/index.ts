import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'orchestrator',
  name: 'Orchestrator',
  version: '1.0.0',
  source: 'core',
  instances: ['core'],

  routes: [
    {
      path: '/orchestrator',
      component: 'OrchestratorPage',
      navItem: {
        label: 'Orchestrator',
        icon: 'Sparkles',
        group: 'ops',
        order: 16,  // 在 Brain (15) 之后
      },
    },
  ],

  components: {
    OrchestratorPage: () => import('./pages/OrchestratorPage'),
  },
};

export default manifest;
