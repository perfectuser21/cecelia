import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'knowledge',
  name: 'Knowledge',
  version: '2.1.0',
  source: 'core',
  instances: ['core'],

  // Knowledge 导航已合并到 GTD System
  navGroups: [],

  routes: [
    { path: '/knowledge', component: 'KnowledgeHome' },
    { path: '/knowledge/content', component: 'ContentStudio' },
    { path: '/knowledge/brain', component: 'SuperBrain' },
    { path: '/knowledge/digestion', component: 'KnowledgeDigestion' },
    { path: '/knowledge/thinking', component: 'ThinkingLog' },
    // Legacy redirects
    { path: '/content', redirect: '/knowledge/content' },
    { path: '/super-brain', redirect: '/knowledge/brain' },
  ],

  components: {
    KnowledgeHome: () => import('./pages/KnowledgeHome'),
    ContentStudio: () => import('../content/pages/ContentStudio'),
    SuperBrain: () => import('../brain/pages/SuperBrain'),
    KnowledgeDigestion: () => import('./pages/KnowledgeDigestion'),
    ThinkingLog: () => import('./pages/ThinkingLog'),
  },
};

export default manifest;
