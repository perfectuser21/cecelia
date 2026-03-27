import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'content',
  name: 'Content',
  version: '1.0.0',
  source: 'core',
  instances: ['core'],

  navGroups: [
    { id: 'content', label: '内容制作', icon: 'Pencil', order: 5 },
  ],

  routes: [
    {
      path: '/content',
      component: 'ContentPipeline',
      navItem: { label: '内容工厂', icon: 'Factory', group: 'content', order: 1 },
    },
  ],

  components: {
    ContentPipeline: () => import('./pages/ContentPipelinePage'),
  },
};

export default manifest;
