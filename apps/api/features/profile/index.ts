import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'profile',
  name: 'Profile',
  version: '1.0.0',
  source: 'core',
  instances: ['core'],

  routes: [
    {
      path: '/knowledge/memory',
      component: 'ProfileFacts',
      navItem: {
        label: 'Memory', icon: 'BrainCircuit', group: 'knowledge', order: 4,
      },
    },
  ],

  components: {
    ProfileFacts: () => import('./pages/ProfileFactsPage'),
  },
};

export default manifest;
