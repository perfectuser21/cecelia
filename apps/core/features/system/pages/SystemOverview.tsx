import { Link } from 'react-router-dom';
import {
  Server,
  Cpu,
  Activity,
  Settings,
  ListTodo,
  Monitor,
  Clock,
  ChevronRight,
  ArrowLeft,
} from 'lucide-react';

const pages = [
  {
    id: 'vps',
    title: 'VPS Monitor',
    description: 'CPU、内存、磁盘、网络状态',
    icon: Cpu,
    path: '/ops/system/vps',
  },
  {
    id: 'engine',
    title: 'Engine Dashboard',
    description: '引擎状态和概览',
    icon: Activity,
    path: '/ops/system/engine',
  },
  {
    id: 'capabilities',
    title: 'Capabilities',
    description: 'Engine 能力配置',
    icon: Settings,
    path: '/ops/system/capabilities',
  },
  {
    id: 'dev-tasks',
    title: 'Dev Tasks',
    description: '开发任务列表',
    icon: ListTodo,
    path: '/ops/system/dev-tasks',
  },
  {
    id: 'task-monitor',
    title: 'Task Monitor',
    description: '任务监控',
    icon: Monitor,
    path: '/ops/system/task-monitor',
  },
  {
    id: 'session-monitor',
    title: 'Session Monitor',
    description: '会话监控',
    icon: Clock,
    path: '/ops/system/session-monitor',
  },
];

export default function SystemOverview() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          to="/ops"
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-400" />
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center">
            <Server className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">System</h1>
            <p className="text-sm text-gray-400">系统状态和 Engine 管理</p>
          </div>
        </div>
      </div>

      {/* Page Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {pages.map((page) => {
          const Icon = page.icon;
          return (
            <Link
              key={page.id}
              to={page.path}
              className="group flex items-center gap-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg p-4 transition-all"
            >
              <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center">
                <Icon className="w-5 h-5 text-blue-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-medium text-white">{page.title}</h3>
                <p className="text-sm text-gray-400">{page.description}</p>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-500 group-hover:text-white transition-colors" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
