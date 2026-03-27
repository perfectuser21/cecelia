import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'gtd',
  name: 'GTD System',
  version: '1.0.0',
  source: 'core',
  instances: ['core'],

  navGroups: [
    { id: 'gtd', label: 'GTD System', icon: 'LayoutGrid', order: 2.5 },
  ],

  routes: [
    // GTD 主入口 — Area 视图
    {
      path: '/gtd',
      component: 'GTDArea',
      navItem: {
        label: 'GTD System', icon: 'LayoutGrid', group: 'gtd',
        children: [
          { path: '/gtd/inbox', label: 'Inbox', icon: 'Inbox', order: 0 },
          { path: '/gtd/area', label: 'Area', icon: 'Layers', order: 1 },
          { path: '/gtd/okr', label: 'OKR', icon: 'Target', order: 2 },
          { path: '/gtd/projects', label: 'Projects', icon: 'FolderKanban', order: 3 },
          { path: '/gtd/tasks', label: 'Tasks', icon: 'ListTodo', order: 4 },
          { path: '/gtd/knowledge', label: 'Knowledge', icon: 'BookOpen', order: 5 },
          { path: '/gtd/warroom', label: 'War Room', icon: 'Crosshair', order: 6 },
        ],
      },
    },
    // GTD 子路由
    { path: '/gtd/inbox', component: 'GTDInbox' },
    { path: '/gtd/area', component: 'GTDArea' },
    { path: '/gtd/okr', component: 'GTDOkr' },
    { path: '/gtd/projects', component: 'GTDProjects' },
    { path: '/gtd/projects/:projectId', component: 'ProjectDetail' },
    { path: '/gtd/initiatives/:id', component: 'InitiativeDetail' },
    { path: '/gtd/tasks', component: 'GTDTasks' },
    { path: '/gtd/knowledge', component: 'GTDKnowledge' },
    { path: '/gtd/warroom', component: 'GTDWarRoom' },
    { path: '/gtd/warroom/:area', component: 'GTDWarRoomArea' },
  ],

  components: {
    GTDInbox: () => import('./pages/GTDInbox'),
    GTDArea: () => import('./pages/GTDArea'),
    GTDOkr: () => import('./pages/GTDOkr'),
    GTDProjects: () => import('./pages/GTDProjects'),
    GTDTasks: () => import('./pages/GTDTasks'),
    GTDKnowledge: () => import('./pages/GTDKnowledge'),
    GTDWarRoom: () => import('./pages/GTDWarRoom'),
    GTDWarRoomArea: () => import('./pages/GTDWarRoomArea'),
    ProjectDetail: () => import('../planning/pages/ProjectDetail'),
    InitiativeDetail: () => import('../planning/pages/InitiativeDetail'),
  },
};

export default manifest;
