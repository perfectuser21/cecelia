import { FolderKanban, Map, ListTodo, GitBranch } from 'lucide-react';
import TabbedPage from '../../shared/components/TabbedPage';
import type { TabConfig } from '../../shared/components/TabbedPage';

const tabs: TabConfig[] = [
  {
    id: 'projects',
    label: 'Projects',
    icon: FolderKanban,
    path: '/work',
    component: () => import('../../planning/pages/ProjectsDashboard'),
  },
  {
    id: 'okr',
    label: 'OKR',
    icon: GitBranch,
    path: '/work/okr',
    component: () => import('../../planning/pages/OKRHierarchyView'),
  },
  {
    id: 'tasks',
    label: 'Tasks',
    icon: ListTodo,
    path: '/work/tasks',
    component: () => import('../../planning/pages/TaskDatabase'),
  },
  {
    id: 'roadmap',
    label: 'Roadmap',
    icon: Map,
    path: '/work/roadmap',
    component: () => import('../../planning/pages/RoadmapView'),
  },
];

export default function WorkTabbed() {
  return <TabbedPage tabs={tabs} basePath="/work" />;
}
