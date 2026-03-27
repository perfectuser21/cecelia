import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'knowledge',
  name: 'Knowledge',
  version: '2.2.0',
  source: 'core',
  instances: ['core'],

  navGroups: [
    { id: 'knowledge-docs', label: '知识库', icon: 'BookOpen', order: 6 },
  ],

  routes: [
    { path: '/knowledge', component: 'KnowledgeHome' },
    { path: '/knowledge/content', component: 'ContentStudio' },
    { path: '/knowledge/brain', component: 'SuperBrain' },
    { path: '/knowledge/digestion', component: 'KnowledgeDigestion' },
    { path: '/knowledge/instruction-book', component: 'InstructionBook' },
    // Documentation System
    {
      path: '/knowledge/map',
      component: 'KnowledgeMap',
      navItem: { label: '知识地图', icon: 'Map', group: 'knowledge-docs', order: 1 },
    },
    {
      path: '/knowledge/dev-log',
      component: 'DevLog',
      navItem: { label: 'Dev Log', icon: 'GitMerge', group: 'knowledge-docs', order: 2 },
    },
    {
      path: '/knowledge/decisions',
      component: 'DecisionRegistry',
      navItem: { label: '决策台账', icon: 'Scale', group: 'knowledge-docs', order: 3 },
    },
    {
      path: '/knowledge/designs',
      component: 'DesignVault',
      navItem: { label: '设计文档', icon: 'FolderOpen', group: 'knowledge-docs', order: 4 },
    },
    {
      path: '/knowledge/diary',
      component: 'DailyDiary',
      navItem: { label: '每日日报', icon: 'BookOpen', group: 'knowledge-docs', order: 5 },
    },
    {
      path: '/knowledge/strategy-tree',
      component: 'StrategyTree',
      navItem: { label: 'Strategy Tree', icon: 'GitBranch', group: 'knowledge-docs', order: 6 },
    },
    // Knowledge Modules
    {
      path: '/knowledge/modules',
      component: 'KnowledgeModules',
      navItem: { label: '知识模块', icon: 'Layers', group: 'knowledge-docs', order: 7 },
    },
    { path: '/knowledge/modules/:groupId/:moduleId', component: 'KnowledgeModuleDetail' },
    // 内容工厂
    {
      path: '/content-factory',
      component: 'ContentFactory',
      requireAuth: false,
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
    // Documentation System
    DevLog: () => import('./pages/DevLog'),
    DecisionRegistry: () => import('./pages/DecisionRegistry'),
    DesignVault: () => import('./pages/DesignVault'),
    DailyDiary: () => import('./pages/DailyDiary'),
    KnowledgeMap: () => import('./pages/KnowledgeMap'),
    StrategyTree: () => import('./pages/StrategyTree'),
    KnowledgeModules: () => import('./pages/KnowledgeModules'),
    KnowledgeModuleDetail: () => import('./pages/KnowledgeModuleDetail'),
    ContentFactory: () => import('../content/pages/ContentFactory'),
  },
};

export default manifest;
