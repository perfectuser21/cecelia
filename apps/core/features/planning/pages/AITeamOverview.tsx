import { Link } from 'react-router-dom';
import {
  Bot,
  Users,
  Workflow,
  Activity,
  ChevronRight,
  ArrowLeft,
} from 'lucide-react';

const pages = [
  {
    id: 'workers',
    title: 'AI Workers',
    description: 'AI 员工总览和管理',
    icon: Users,
    path: '/company/ai-team/workers',
  },
  {
    id: 'workflows',
    title: 'Workflows',
    description: 'N8N 工作流列表',
    icon: Workflow,
    path: '/company/ai-team/workflows',
  },
  {
    id: 'live-status',
    title: 'Live Status',
    description: '工作流实时执行状态',
    icon: Activity,
    path: '/company/ai-team/live-status',
  },
];

export default function AITeamOverview() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          to="/company"
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-400" />
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">AI Team</h1>
            <p className="text-sm text-gray-400">AI 员工和工作流管理</p>
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
                <Icon className="w-5 h-5 text-purple-400" />
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
