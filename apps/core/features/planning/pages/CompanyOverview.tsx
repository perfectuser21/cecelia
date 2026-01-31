import { Link } from 'react-router-dom';
import {
  Building2,
  Bot,
  ListTodo,
  Share2,
  Users,
  DollarSign,
  ChevronRight,
} from 'lucide-react';

const sections = [
  {
    id: 'ai-team',
    title: 'AI Team',
    description: 'AI 员工管理、N8N 工作流',
    icon: Bot,
    path: '/company/ai-team',
    color: 'from-purple-500 to-pink-500',
  },
  {
    id: 'tasks',
    title: 'Tasks',
    description: '任务管理',
    icon: ListTodo,
    path: '/company/tasks',
    color: 'from-blue-500 to-cyan-500',
  },
  {
    id: 'media',
    title: 'Media',
    description: '自媒体数据统计',
    icon: Share2,
    path: '/company/media',
    color: 'from-green-500 to-emerald-500',
  },
  {
    id: 'team',
    title: 'Team',
    description: '人员管理',
    icon: Users,
    path: '/company/team',
    color: 'from-orange-500 to-amber-500',
    placeholder: true,
  },
  {
    id: 'finance',
    title: 'Finance',
    description: '财务管理',
    icon: DollarSign,
    path: '/company/finance',
    color: 'from-rose-500 to-red-500',
    placeholder: true,
  },
];

export default function CompanyOverview() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-lg">
          <Building2 className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Company</h1>
          <p className="text-gray-400">公司管理</p>
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
              className="group bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-5 transition-all hover:scale-[1.02] relative"
            >
              {section.placeholder && (
                <span className="absolute top-3 right-3 text-xs bg-gray-500/30 text-gray-400 px-2 py-0.5 rounded">
                  Coming Soon
                </span>
              )}
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
