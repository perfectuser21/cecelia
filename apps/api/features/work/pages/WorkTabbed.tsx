import { FolderKanban, Map, ListTodo, Zap, Layers } from 'lucide-react';
import TabbedPage from '../../shared/components/TabbedPage';
import type { TabConfig } from '../../shared/components/TabbedPage';

const tabs: TabConfig[] = [
  {
    id: 'area',
    label: 'Area',
    icon: Layers,
    path: '/work',
    component: () => import('../../planning/pages/AreaDashboard'),
  },
  {
    id: 'projects',
    label: 'Projects',
    icon: FolderKanban,
    path: '/work/projects',
    component: () => import('../../planning/pages/ProjectsDashboard'),
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
  {
    id: 'streams',
    label: 'Streams',
    icon: Zap,
    path: '/work/streams',
    component: () => import('./WorkStreams'),
  },
];

export default function WorkTabbed() {
  return <TabbedPage tabs={tabs} basePath="/work" />;
}
