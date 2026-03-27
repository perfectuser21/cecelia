import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Brain, Zap, GitBranch, Server, CheckCircle, Clock, ChevronRight } from 'lucide-react';
import { useApi } from '../../shared/hooks/useApi';

interface ModuleItem {
  id: string;
  title: string;
  desc: string;
  priority: string;
  status: string;
  output_url: string | null;
  source_files: string[];
  completed: string | null;
}

interface ModuleGroup {
  id: string;
  label: string;
  items: ModuleItem[];
}

interface ModulesData {
  meta: {
    total?: number;
    done?: number;
    last_updated?: string;
  };
  groups: ModuleGroup[];
}

const GROUP_ICONS: Record<string, React.ElementType> = {
  brain: Brain,
  engine: Zap,
  workflows: GitBranch,
  system: Server,
};

const GROUP_COLORS: Record<string, string> = {
  brain: 'bg-blue-500',
  engine: 'bg-purple-500',
  workflows: 'bg-green-500',
  system: 'bg-orange-500',
};

const PRIORITY_BADGE: Record<string, string> = {
  P0: 'bg-red-100 text-red-700',
  P1: 'bg-yellow-100 text-yellow-700',
  P2: 'bg-gray-100 text-gray-500',
};

function ModuleCard({ item, groupId }: { item: ModuleItem; groupId: string }) {
  const navigate = useNavigate();
  const isDone = item.status === 'done';

  return (
    <button
      onClick={() => navigate(`/knowledge/modules/${groupId}/${item.id}`)}
      className="w-full text-left bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-400 hover:shadow-md transition-all group"
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-gray-900 group-hover:text-blue-600 transition-colors leading-snug">
          {item.title}
        </h4>
        <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${PRIORITY_BADGE[item.priority] || PRIORITY_BADGE.P2}`}>
          {item.priority}
        </span>
      </div>
      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{item.desc}</p>
      <div className="flex items-center justify-between mt-3">
        <div className={`flex items-center gap-1 text-xs ${isDone ? 'text-green-600' : 'text-gray-400'}`}>
          {isDone ? <CheckCircle size={12} /> : <Clock size={12} />}
          <span>{isDone ? '已完成' : '待生成'}</span>
        </div>
        <ChevronRight size={14} className="text-gray-300 group-hover:text-blue-400 transition-colors" />
      </div>
    </button>
  );
}

function GroupSection({ group }: { group: ModuleGroup }) {
  const [expanded, setExpanded] = useState(true);
  const Icon = GROUP_ICONS[group.id] || Server;
  const colorClass = GROUP_COLORS[group.id] || 'bg-gray-500';
  const doneCount = group.items.filter(i => i.status === 'done').length;

  return (
    <div className="mb-8">
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-3 mb-4 w-full text-left group"
      >
        <div className={`w-8 h-8 rounded-lg ${colorClass} flex items-center justify-center`}>
          <Icon size={16} className="text-white" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-gray-900">{group.label}</h3>
          <p className="text-xs text-gray-500">{doneCount}/{group.items.length} 已完成</p>
        </div>
        <ChevronRight
          size={16}
          className={`text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>
      {expanded && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {group.items.map(item => (
            <ModuleCard key={item.id} item={item} groupId={group.id} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function KnowledgeModules() {
  const { data, loading, error } = useApi<ModulesData>(
    '/api/brain/knowledge/modules',
    { staleTime: 300_000 }
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p>加载失败：{error || '未知错误'}</p>
      </div>
    );
  }

  const { meta, groups } = data;

  return (
    <div className="max-w-5xl mx-auto">
      {/* 标题区 */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">知识模块</h1>
        <p className="text-sm text-gray-500">
          Cecelia 系统深度知识页 · 共 {meta.total ?? 0} 个模块，已完成 {meta.done ?? 0} 个
          {meta.last_updated && ` · 更新于 ${meta.last_updated}`}
        </p>
      </div>

      {/* 模块分组 */}
      {groups.map(group => (
        <GroupSection key={group.id} group={group} />
      ))}
    </div>
  );
}
