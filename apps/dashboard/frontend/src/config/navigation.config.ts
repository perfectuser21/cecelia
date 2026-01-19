/**
 * 导航配置 - 配置驱动 UI
 *
 * 这个文件定义了菜单和路由的配置
 * 修改这里就能添加/删除/修改页面，无需改动其他代码
 */

import { lazy, ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  BarChart3,
  Database,
  FileText,
  Sparkles,
  Settings,
  Activity,
  MonitorDot,
  Server,
  DollarSign,
  Workflow,
  ListTodo,
  TrendingUp,
  Radio,
  Palette,
  Bot,
  Cpu,
  Code,
  Video,  // 新媒体运营图标
} from 'lucide-react';

// ============ 类型定义 ============

export interface NavItem {
  path: string;
  icon: LucideIcon;
  label: string;
  featureKey: string;
  // 权限控制
  requireSuperAdmin?: boolean;
  // 路由配置
  component?: string;  // 组件路径，用于懒加载
  redirect?: string;   // 重定向目标
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export interface RouteConfig {
  path: string;
  component?: string;
  redirect?: string;
  requireAuth?: boolean;
  requireSuperAdmin?: boolean;
}

// ============ 页面组件懒加载映射 ============

// 懒加载所有页面组件
// 从 zenithjoy-core/features 加载的组件使用 @features/core 别名
export const pageComponents: Record<string, () => Promise<{ default: ComponentType }>> = {
  // --- 本地页面（autopilot 专用） ---
  'Dashboard': () => import('../pages/Dashboard'),
  'ContentData': () => import('../pages/ContentData'),
  'ContentPublish': () => import('../pages/ContentPublish'),
  'ExecutionStatus': () => import('../pages/ExecutionStatus'),
  'Tasks': () => import('../pages/Tasks'),
  'PlatformStatus': () => import('../pages/PlatformStatus'),
  'PublishStats': () => import('../pages/PublishStats'),
  'LoginPage': () => import('../pages/LoginPage'),
  'PlatformStatusDashboard': () => import('../pages/PlatformStatusDashboard'),
  'ToolsPage': () => import('../pages/ToolsPage'),
  'ScrapingPage': () => import('../pages/ScrapingPage'),
  'AdminSettingsPage': () => import('../pages/AdminSettingsPage'),
  'MediaScenarioPage': () => import('../pages/MediaScenarioPage'),

  // --- 从 zenithjoy-core/features 加载（个人功能） ---
  // claude-monitor feature
  'ClaudeMonitor': () => import('@features/core/claude-monitor/pages/ClaudeMonitor'),
  'ClaudeStats': () => import('@features/core/claude-monitor/pages/ClaudeStats'),

  // vps-monitor feature
  'VpsMonitor': () => import('@features/core/vps-monitor/pages/VpsMonitor'),

  // engine feature
  'EngineDashboard': () => import('@features/core/engine/pages/EngineDashboard'),
  'EngineCapabilities': () => import('@features/core/engine/pages/EngineCapabilities'),
  'DevTasks': () => import('@features/core/engine/pages/DevTasks'),
  'TaskMonitor': () => import('@features/core/engine/pages/TaskMonitor'),
  'SessionMonitor': () => import('@features/core/engine/pages/SessionMonitor'),

  // n8n feature
  'N8nWorkflows': () => import('@features/core/n8n/pages/N8nWorkflows'),
  'N8nWorkflowDetail': () => import('@features/core/n8n/pages/N8nWorkflowDetail'),
  'N8nLiveStatus': () => import('@features/core/n8n/pages/N8nLiveStatus'),
  'N8nLiveStatusDetail': () => import('@features/core/n8n/pages/N8nLiveStatusDetail'),

  // cecilia feature
  'CeciliaRuns': () => import('@features/core/cecilia/pages/CeciliaRuns'),

  // canvas feature
  'Canvas': () => import('@features/core/canvas/pages/Canvas'),
  'Whiteboard': () => import('@features/core/canvas/pages/Whiteboard'),
  'ProjectPanorama': () => import('@features/core/canvas/pages/ProjectPanorama'),
};

// 获取懒加载组件
export function getPageComponent(name: string) {
  const loader = pageComponents[name];
  if (!loader) {
    console.warn(`Page component not found: ${name}`);
    return null;
  }
  return lazy(loader);
}

// ============ Core 实例导航配置 ============

export const coreNavGroups: NavGroup[] = [
  {
    title: '概览',
    items: [
      {
        path: '/',
        icon: LayoutDashboard,
        label: '工作台',
        featureKey: 'workbench',
        component: 'EngineDashboard'
      },
    ]
  },
  {
    title: 'Engine',
    items: [
      {
        path: '/engine',
        icon: Cpu,
        label: '能力概览',
        featureKey: 'engine-capabilities',
        component: 'EngineCapabilities'
      },
      {
        path: '/engine/tasks',
        icon: Activity,
        label: '任务监控',
        featureKey: 'task-monitor',
        component: 'TaskMonitor'
      },
      {
        path: '/engine/dev',
        icon: Code,
        label: '开发任务',
        featureKey: 'dev-tasks',
        component: 'DevTasks'
      },
    ]
  },
  {
    title: 'Cecilia',
    items: [
      {
        path: '/cecilia',
        icon: Bot,
        label: '任务总览',
        featureKey: 'cecilia-tasks',
        component: 'CeciliaRuns'
      },
      {
        path: '/cecilia/history',
        icon: ListTodo,
        label: '历史记录',
        featureKey: 'cecilia-history',
        component: 'CeciliaRuns'
      },
      {
        path: '/cecilia/stats',
        icon: BarChart3,
        label: '统计分析',
        featureKey: 'cecilia-stats',
        component: 'CeciliaRuns'
      },
      {
        path: '/cecilia/logs',
        icon: Activity,
        label: '执行日志',
        featureKey: 'cecilia-logs',
        component: 'CeciliaRuns'
      },
    ]
  },
  {
    title: '系统',
    items: [
      {
        path: '/settings',
        icon: Settings,
        label: '配置',
        featureKey: 'settings',
        requireSuperAdmin: true,
        component: 'AdminSettingsPage'
      },
    ]
  }
];

// ============ Autopilot 实例导航配置 ============

export const autopilotNavGroups: NavGroup[] = [
  {
    title: '',  // 无分组标题，扁平展示
    items: [
      {
        path: '/',
        icon: LayoutDashboard,
        label: '工作台',
        featureKey: 'workbench',
        component: 'Dashboard'
      },
      {
        path: '/media',
        icon: Video,
        label: '新媒体运营',
        featureKey: 'media-scenario',
        component: 'MediaScenarioPage'
      },
      {
        path: '/settings',
        icon: Settings,
        label: '设置',
        featureKey: 'settings',
        requireSuperAdmin: true,
        component: 'AdminSettingsPage'
      },
    ]
  }
];

// ============ 额外路由配置（不在菜单显示） ============

export const additionalRoutes: RouteConfig[] = [
  // === 新媒体运营场景子路由 ===
  // 这些路由由 MediaScenarioPage 内部处理嵌套路由
  { path: '/media/*', component: 'MediaScenarioPage', requireAuth: true },

  // === 旧路由重定向（兼容） ===
  { path: '/content', redirect: '/media/content' },
  { path: '/scraping', redirect: '/media/content/scraping' },
  { path: '/tasks', redirect: '/media/publish' },
  { path: '/tasks/:name', redirect: '/media/publish' },
  { path: '/execution-status', redirect: '/media/publish/history' },
  { path: '/platform-status', redirect: '/media/publish/platforms' },
  { path: '/publish-stats', redirect: '/media/data' },
  { path: '/data-center', redirect: '/media/data/analytics' },
  { path: '/tools', redirect: '/settings' },
  { path: '/canvas', redirect: '/settings' },

  // 登录相关
  { path: '/login/:platform/:accountId', component: 'LoginPage', requireAuth: true },
  { path: '/platform-login', component: 'PlatformStatusDashboard', requireAuth: true },

  // 工具子页面（移入设置）
  { path: '/tools/session-monitor', redirect: '/settings' },

  // 管理员子页面
  { path: '/settings/claude-monitor', component: 'ClaudeMonitor', requireAuth: true, requireSuperAdmin: true },
  { path: '/settings/vps-monitor', component: 'VpsMonitor', requireAuth: true, requireSuperAdmin: true },
  { path: '/settings/claude-stats', component: 'ClaudeStats', requireAuth: true, requireSuperAdmin: true },
  { path: '/settings/n8n-workflows', component: 'N8nWorkflows', requireAuth: true, requireSuperAdmin: true },
  { path: '/settings/n8n-workflows/:instance/:id', component: 'N8nWorkflowDetail', requireAuth: true, requireSuperAdmin: true },
  { path: '/settings/n8n-status', component: 'N8nLiveStatus', requireAuth: true, requireSuperAdmin: true },
  { path: '/settings/n8n-status/:executionId', component: 'N8nLiveStatusDetail', requireAuth: true, requireSuperAdmin: true },
  { path: '/settings/canvas', component: 'Canvas', requireAuth: true, requireSuperAdmin: true },

  // 旧重定向
  { path: '/panorama', redirect: '/settings/canvas' },
  { path: '/whiteboard', redirect: '/settings/canvas' },
];

// ============ 辅助函数 ============

/**
 * 根据实例类型获取导航配置
 */
export function getNavGroups(isCore: boolean): NavGroup[] {
  return isCore ? coreNavGroups : autopilotNavGroups;
}

/**
 * 过滤菜单项（根据 feature flag 和权限）
 */
export function filterNavGroups(
  groups: NavGroup[],
  isFeatureEnabled: (key: string) => boolean,
  isSuperAdmin: boolean
): NavGroup[] {
  return groups
    .map(group => ({
      ...group,
      items: group.items.filter(item => {
        // 检查 feature flag
        if (!isFeatureEnabled(item.featureKey)) return false;
        // 检查超级管理员权限
        if (item.requireSuperAdmin && !isSuperAdmin) return false;
        return true;
      })
    }))
    .filter(group => group.items.length > 0);
}

/**
 * 从导航配置中提取所有路由
 */
export function extractRoutesFromNav(groups: NavGroup[]): RouteConfig[] {
  const routes: RouteConfig[] = [];

  for (const group of groups) {
    for (const item of group.items) {
      routes.push({
        path: item.path,
        component: item.component,
        redirect: item.redirect,
        requireAuth: true,
        requireSuperAdmin: item.requireSuperAdmin,
      });
    }
  }

  return routes;
}
