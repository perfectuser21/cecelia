import { FolderKanban, Target, Map, Layers, ListTodo, Building2, Users, GitBranch } from 'lucide-react';
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
    id: 'okr-hierarchy',
    label: 'OKR Hierarchy',
    icon: GitBranch,
    path: '/work/okr',
    component: () => import('../../planning/pages/OKRHierarchyView'),
  },
  {
    id: 'businesses',
    label: 'Businesses',
    icon: Building2,
    path: '/work/businesses',
    component: () => import('../../planning/pages/BusinessManagement'),
  },
  {
    id: 'departments',
    label: 'Departments',
    icon: Users,
    path: '/work/departments',
    component: () => import('../../planning/pages/DepartmentManagement'),
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
    id: 'features',
    label: 'Features',
    icon: Layers,
    path: '/work/features',
    component: () => import('../../shared/pages/FeatureDashboard'),
  },
];

export default function WorkTabbed() {
  return <TabbedPage tabs={tabs} basePath="/work" />;
}
