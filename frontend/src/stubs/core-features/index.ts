/**
 * Core features for cecelia-core standalone mode
 * Provides Brain/Seats management UI
 */

import type { CoreDynamicConfig } from '../../contexts/InstanceContext';
import {
  LayoutDashboard,
  Monitor,
  Settings,
  Target,
  ListTodo,
} from 'lucide-react';

// Core Instance 配置
const instanceConfig = {
  instance: 'core',
  name: 'Cecelia Core',
  theme: {
    logo: '/cecelia-logo.svg',
    primaryColor: '#3b82f6',
    sidebarGradient: 'linear-gradient(180deg, #1e40af 0%, #1e3a8a 100%)',
  },
  features: {
    'dashboard': true,
    'seats': true,
    'goals': true,
    'tasks': true,
    'settings': true,
  }
};

// Core 导航配置
const navGroups = [
  {
    title: '总览',
    items: [
      {
        path: '/',
        icon: LayoutDashboard,
        label: '工作台',
        featureKey: 'dashboard',
        component: 'Dashboard'
      },
      {
        path: '/seats',
        icon: Monitor,
        label: 'Seats 状态',
        featureKey: 'seats',
        component: 'SeatsStatus'
      },
    ]
  },
  {
    title: '任务系统',
    items: [
      {
        path: '/goals',
        icon: Target,
        label: 'OKR 目标',
        featureKey: 'goals',
        component: 'GoalsPage'  // TODO: create this page
      },
      {
        path: '/tasks',
        icon: ListTodo,
        label: '任务队列',
        featureKey: 'tasks',
        component: 'TasksPage'  // TODO: create this page
      },
    ]
  },
];

// 页面组件映射
const pageComponents: Record<string, () => Promise<{ default: any }>> = {
  'Dashboard': () => import('../../pages/Dashboard'),
  'SeatsStatus': () => import('../../pages/SeatsStatus'),
  // TODO: Add Goals and Tasks pages
  'GoalsPage': () => import('../../pages/Dashboard'),  // placeholder
  'TasksPage': () => import('../../pages/Dashboard'),  // placeholder
};

export async function buildCoreConfig(): Promise<CoreDynamicConfig> {
  return {
    instanceConfig,
    navGroups,
    pageComponents,
  };
}

export const coreFeatures = {};
export const coreInstanceConfig = instanceConfig;
export const coreTheme = instanceConfig.theme;
