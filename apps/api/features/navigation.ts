import type { NavGroup, NavGroupItem } from './types';

function entry(
  path: string,
  label: string,
  icon: string,
  options: Pick<NavGroupItem, 'children' | 'exact'> = {},
): NavGroupItem {
  return { path, label, icon, featureKey: `navigation:${path}`, ...options };
}

// 日常业务看板由 Notion 承接；这里仅定义 Cecelia 的可见入口，路由仍由各 manifest 注册。
export function buildCoreNavigation(): NavGroup[] {
  return [{
    title: '',
    items: [
      entry('/workbench/inbox', '交代事情', 'Inbox', {
        children: [
          entry('/workbench/inbox', '收件箱', 'Inbox'),
          entry('/cecelia/chat', '与 Cecelia 对话', 'MessageCircle'),
        ],
      }),
      entry('/machines', '机器与资源', 'Server', {
        children: [
          entry('/machines', '设备清单', 'Monitor'),
          entry('/system/infra', '资源监控', 'Server'),
          entry('/live-monitor', '运行监控', 'Activity'),
          entry('/system/claude', '会话管理', 'MessagesSquare'),
        ],
      }),
      entry('/brain-models', 'AI 管理', 'Brain', {
        children: [
          entry('/brain-models', '模型方案', 'Cpu'),
          entry('/system/team', '员工配置', 'Users'),
          entry('/knowledge/memory', '记忆管理', 'Brain'),
          entry('/settings', '系统设置', 'Settings'),
        ],
      }),
      entry('/system', '诊断与复盘', 'Activity', {
        children: [
          entry('/system', '运行健康', 'Activity', { exact: true }),
          entry('/system/cecelia', '执行概览', 'Bot'),
          entry('/system/automation', '自动化运行', 'Workflow'),
          entry('/system/engine', '开发引擎', 'Cpu'),
          entry('/map', '功能地图', 'Map'),
          entry('/system/feature-map', '架构图', 'Network'),
          entry('/test-pyramid', '测试质量', 'Triangle'),
          entry('/traces', '调用追踪', 'Route'),
          entry('/ledger', '功能账本', 'ClipboardList'),
          entry('/workbench/activity', '活动记录', 'History'),
          entry('/knowledge/dev-log', '开发日志', 'FileText'),
          entry('/cecelia/growth', '成长档案', 'Sprout'),
          entry('/cecelia/evolution', '进化复盘', 'TrendingUp'),
        ],
      }),
    ],
  }];
}
