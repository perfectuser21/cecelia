import { FeatureManifest } from '../types';
import { Activity } from 'lucide-react';

const manifest: FeatureManifest = {
  id: 'quality',
  name: 'Quality Monitor',
  version: '1.0.0',
  source: 'core',
  instances: ['core'],

  routes: [
    {
      path: '/quality',
      component: 'QualityMonitorPage',
      navItem: {
        label: '质量监控',
        icon: Activity,
        order: 50,
      },
    },
  ],

  components: {
    QualityMonitorPage: () => import('./pages/QualityMonitorPage'),
  },
};

export default manifest;
