import { FolderKanban, Target, Map, Layers } from 'lucide-react';
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
    icon: Target,
    path: '/work/okr',
    component: () => import('../../planning/pages/OKRPage'),
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
