import type { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'content',
  name: 'Content',
  version: '1.0.0',
  source: 'core',
  instances: ['core'],
  navGroups: [
    { id: 'content', label: '内容工厂', icon: 'PenLine', order: 7 },
  ],
  routes: [
    {
      path: '/content/config',
      component: 'ContentTypeConfigPage',
      navItem: { label: 'Pipeline 配置', icon: 'Settings', group: 'content', order: 1 },
    },
  ],
  components: {
    ContentTypeConfigPage: () => import('./pages/ContentTypeConfigPage'),
  },
};

export default manifest;
