import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'knowledge',
  name: 'Knowledge',
  version: '2.2.0',
  source: 'core',
  instances: ['core'],

  // Knowledge 导航已合并到 GTD System
  navGroups: [],

  routes: [
    { path: '/knowledge', component: 'KnowledgeHome' },
    { path: '/knowledge/content', component: 'ContentStudio' },
    { path: '/knowledge/brain', component: 'SuperBrain' },
    { path: '/knowledge/digestion', component: 'KnowledgeDigestion' },
    { path: '/knowledge/instruction-book', component: 'InstructionBook' },
    // 内容工厂
    {
      path: '/content-factory',
      component: 'ContentFactory',
      navItem: { label: '内容工厂', icon: 'Factory', group: 'execution', order: 10 },
    },
    // Legacy redirects
    { path: '/content', redirect: '/knowledge/content' },
    { path: '/super-brain', redirect: '/knowledge/brain' },
  ],

  components: {
    KnowledgeHome: () => import('./pages/KnowledgeHome'),
    ContentStudio: () => import('../content/pages/ContentStudio'),
    SuperBrain: () => import('../brain/pages/SuperBrain'),
    KnowledgeDigestion: () => import('./pages/KnowledgeDigestion'),
    InstructionBook: () => import('./pages/InstructionBook'),
    ContentFactory: () => import('../content/pages/ContentFactory'),
  },
};

export default manifest;
