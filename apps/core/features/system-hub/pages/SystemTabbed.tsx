import { Activity, Bot, Workflow, Server, Cpu, Map, Settings, Users, Puzzle } from 'lucide-react';
import { Brain } from 'lucide-react';
import TabbedPage from '../../shared/components/TabbedPage';
import type { TabConfig } from '../../shared/components/TabbedPage';

const tabs: TabConfig[] = [
  {
    id: 'ops',
    label: 'Ops',
    icon: Activity,
    path: '/system',
    component: () => import('../../system/pages/OpsDashboard'),
  },
  {
    id: 'cecelia',
    label: 'Cecelia',
    icon: Bot,
    path: '/system/cecelia',
    component: () => import('../../execution/pages/CeceliaOverview'),
  },
  {
    id: 'automation',
    label: 'Automation',
    icon: Workflow,
    path: '/system/automation',
    component: () => import('./SystemAutomationTab'),
  },
  {
    id: 'infra',
    label: 'Infrastructure',
    icon: Server,
    path: '/system/infra',
    component: () => import('../../system/pages/InfrastructureMonitor'),
  },
  {
    id: 'claude',
    label: 'Claude',
    icon: Brain,
    path: '/system/claude',
    component: () => import('../../system/pages/ClaudeMonitor'),
  },
  {
    id: 'engine',
    label: 'Engine',
    icon: Cpu,
    path: '/system/engine',
    component: () => import('./SystemEngineTab'),
  },
  {
    id: 'feature-map',
    label: 'Feature Map',
    icon: Map,
    path: '/system/feature-map',
    component: () => import('../../system/pages/FeatureMap'),
  },
  {
    id: 'model-profile',
    label: '模型配置',
    icon: Settings,
    path: '/system/model-profile',
    component: () => import('../../system/pages/ModelProfileSwitcher'),
  },
  {
    id: 'staff',
    label: '员工',
    icon: Users,
    path: '/system/staff',
    component: () => import('../../system/pages/StaffPage'),
  },
  {
    id: 'skills-registry',
    label: '技能库',
    icon: Puzzle,
    path: '/system/skills-registry',
    component: () => import('../../system/pages/SkillsRegistryPage'),
  },
];

export default function SystemTabbed() {
  return <TabbedPage tabs={tabs} basePath="/system" />;
}
