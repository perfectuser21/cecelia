import { Activity, Bot, Workflow, Server, Cpu, Map, Users, AlarmClock } from 'lucide-react';
import { Brain } from 'lucide-react';
import TabbedPage from '../../shared/components/TabbedPage';
import type { TabConfig } from '../../shared/components/TabbedPage';

const tabs: TabConfig[] = [
  {
    id: 'ops',
    label: '运行健康',
    icon: Activity,
    path: '/system',
    component: () => import('../../system/pages/OpsDashboard'),
  },
  {
    id: 'cecelia',
    label: '执行概览',
    icon: Bot,
    path: '/system/cecelia',
    component: () => import('../../execution/pages/CeceliaOverview'),
  },
  {
    id: 'automation',
    label: '自动化运行',
    icon: Workflow,
    path: '/system/automation',
    component: () => import('./SystemAutomationTab'),
  },
  {
    id: 'alarms',
    label: '闹钟总账',
    icon: AlarmClock,
    path: '/system/alarms',
    component: () => import('./AlarmLedgerTab'),
  },
  {
    id: 'infra',
    label: '资源监控',
    icon: Server,
    path: '/system/infra',
    component: () => import('../../system/pages/InfrastructureMonitor'),
  },
  {
    id: 'claude',
    label: '会话管理',
    icon: Brain,
    path: '/system/claude',
    component: () => import('../../system/pages/ClaudeMonitor'),
  },
  {
    id: 'engine',
    label: '开发引擎',
    icon: Cpu,
    path: '/system/engine',
    component: () => import('./SystemEngineTab'),
  },
  {
    id: 'feature-map',
    label: '架构图',
    icon: Map,
    path: '/system/feature-map',
    component: () => import('../../system/pages/FeatureMap'),
  },
  {
    id: 'team',
    label: '员工配置',
    icon: Users,
    path: '/system/team',
    component: () => import('../../system/pages/TeamPage'),
  },
];

export default function SystemTabbed() {
  return <TabbedPage tabs={tabs} basePath="/system" />;
}
