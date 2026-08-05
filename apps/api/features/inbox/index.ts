import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'inbox',
  name: 'Inbox',
  version: '1.0.0',
  source: 'core',
  instances: ['core'],

  routes: [
    // 旧 /inbox 退役重定向 → GTD Inbox
    { path: '/inbox', redirect: '/gtd/inbox' },
    {
      path: '/okr/review/:id',
      component: 'OkrReviewPage',
    },
  ],

  components: {
    OkrReviewPage: () => import('./pages/OkrReviewPage'),
  },
};

export default manifest;
