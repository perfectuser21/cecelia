import { Link } from 'react-router-dom';
import {
  Activity,
  Server,
  Bot,
  BarChart3,
  Map,
  Sparkles,
  ChevronRight,
} from 'lucide-react';

const sections = [
  {
    id: 'system',
    title: 'System',
    description: 'VPS 状态、Engine 能力、系统健康',
    icon: Server,
    path: '/ops/system',
    color: 'from-blue-500 to-cyan-500',
  },
  {
    id: 'claude',
    title: 'Claude',
    description: '实时监控、使用统计、花费分析',
    icon: Bot,
    path: '/ops/claude',
    color: 'from-purple-500 to-pink-500',
  },
  {
    id: 'devgate',
    title: 'DevGate',
    description: '开发指标、质量趋势',
    icon: BarChart3,
    path: '/ops/devgate',
    color: 'from-green-500 to-emerald-500',
  },
  {
    id: 'panorama',
    title: 'Panorama',
    description: 'VPS 全景、画布、白板、项目视图',
    icon: Map,
    path: '/ops/panorama',
    color: 'from-orange-500 to-amber-500',
  },
  {
    id: 'cecelia',
    title: 'Cecelia',
    description: 'AI 管家、任务执行、运行记录',
    icon: Sparkles,
    path: '/ops/cecelia',
    color: 'from-rose-500 to-red-500',
  },
];

export default function OpsOverview() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
          <Activity className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Ops Center</h1>
          <p className="text-gray-400">技术运维状态总览</p>
        </div>
      </div>

      {/* Section Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <Link
              key={section.id}
              to={section.path}
              className="group bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-5 transition-all hover:scale-[1.02]"
            >
              <div className="flex items-start justify-between">
                <div
                  className={`w-10 h-10 bg-gradient-to-br ${section.color} rounded-lg flex items-center justify-center`}
                >
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <ChevronRight className="w-5 h-5 text-gray-500 group-hover:text-white transition-colors" />
              </div>
              <h3 className="text-lg font-semibold text-white mt-4">
                {section.title}
              </h3>
              <p className="text-sm text-gray-400 mt-1">{section.description}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
