import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'business',
  name: 'Business',
  version: '1.0.0',
  source: 'core',
  instances: ['core'],

  routes: [
    // Command Center (panorama drill-down)
    { path: '/command', component: 'CommandCenter' },
    { path: '/command/*', component: 'CommandCenter' },
    { path: '/command/ai', component: 'AIDetail' },
    { path: '/command/media', component: 'MediaDetail' },
    { path: '/command/clients', component: 'ClientsDetail' },
    { path: '/command/portfolio', component: 'PortfolioDetail' },
    // Feature Dashboard
    { path: '/features', component: 'FeatureDashboard' },
    { path: '/ops/features', redirect: '/features' },
  ],

  components: {
    CommandCenter: () => import('./pages/CommandCenter'),
    AIDetail: () => import('./pages/AIDetail'),
    MediaDetail: () => import('./pages/MediaDetail'),
    ClientsDetail: () => import('./pages/ClientsDetail'),
    PortfolioDetail: () => import('./pages/PortfolioDetail'),
    FeatureDashboard: () => import('./pages/FeatureDashboard'),
  },
};

export default manifest;
