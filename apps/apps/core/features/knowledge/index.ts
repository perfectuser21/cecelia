import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'knowledge',
  name: 'Knowledge',
  version: '2.0.0',
  source: 'core',
  instances: ['core'],

  navGroups: [
    { id: 'knowledge', label: 'Knowledge', icon: 'BookOpen', order: 4 },
  ],

  routes: [
    {
      path: '/knowledge',
      component: 'KnowledgeHome',
      navItem: {
        label: 'Knowledge', icon: 'BookOpen', group: 'knowledge',
        children: [
          { path: '/knowledge', label: 'Home', icon: 'BookOpen', order: 1 },
          { path: '/knowledge/content', label: 'Content Studio', icon: 'PenTool', order: 2 },
          { path: '/knowledge/brain', label: 'Super Brain', icon: 'Brain', order: 3 },
        ],
      },
    },
    { path: '/knowledge/content', component: 'ContentStudio' },
    { path: '/knowledge/brain', component: 'SuperBrain' },
    // Legacy redirects
    { path: '/content', redirect: '/knowledge/content' },
    { path: '/super-brain', redirect: '/knowledge/brain' },
  ],

  components: {
    KnowledgeHome: () => import('./pages/KnowledgeHome'),
    ContentStudio: () => import('../content/pages/ContentStudio'),
    SuperBrain: () => import('../brain/pages/SuperBrain'),
  },
};

export default manifest;
