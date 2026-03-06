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
      navItem: { label: 'Knowledge', icon: 'BookOpen', group: 'knowledge' },
    },
    { path: '/knowledge/content', component: 'ContentStudio' },
    { path: '/knowledge/brain', component: 'SuperBrain' },
    { path: '/knowledge/thinking', component: 'ThinkingLog' },
    // Legacy redirects
    { path: '/content', redirect: '/knowledge/content' },
    { path: '/super-brain', redirect: '/knowledge/brain' },
  ],

  components: {
    KnowledgeHome: () => import('./pages/KnowledgeHome'),
    ContentStudio: () => import('../content/pages/ContentStudio'),
    SuperBrain: () => import('../brain/pages/SuperBrain'),
    ThinkingLog: () => import('./pages/ThinkingLog'),
  },
};

export default manifest;
