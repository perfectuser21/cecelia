import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'inbox',
  name: 'Inbox',
  version: '1.0.0',
  source: 'core',
  instances: ['core'],

  navGroups: [
    { id: 'inbox', label: 'Inbox', icon: 'Inbox', order: 1.5 },
  ],

  routes: [
    {
      path: '/inbox',
      component: 'InboxPage',
      navItem: {
        label: '收件箱',
        icon: 'Inbox',
        group: 'inbox',
        order: 1,
      },
    },
    {
      path: '/okr/review/:id',
      component: 'OkrReviewPage',
    },
  ],

  components: {
    InboxPage: () => import('./pages/InboxPage'),
    OkrReviewPage: () => import('./pages/OkrReviewPage'),
  },
};

export default manifest;
