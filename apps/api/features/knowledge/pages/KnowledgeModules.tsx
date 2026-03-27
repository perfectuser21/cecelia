import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, FileCode, Brain, Cog, Workflow, Database } from 'lucide-react';

interface Module {
  id: string;
  title: string;
  desc: string;
  priority: 'P0' | 'P1' | 'P2';
  status: string;
  source_files: string[];
  output_url: string | null;
}

interface ModulesData {
  meta: { total?: number; done?: number; last_updated?: string };
  groups: {
    brain: Module[];
    engine: Module[];
    system: Module[];
    workflows: Module[];
  };
}

const GROUP_CONFIG = {
  brain: { label: 'Brain', icon: Brain, color: 'text-purple-400', bg: 'bg-purple-400/10 border-purple-400/20' },
  engine: { label: 'Engine', icon: Cog, color: 'text-blue-400', bg: 'bg-blue-400/10 border-blue-400/20' },
  system: { label: 'System', icon: Database, color: 'text-green-400', bg: 'bg-green-400/10 border-green-400/20' },
  workflows: { label: 'Workflows', icon: Workflow, color: 'text-orange-400', bg: 'bg-orange-400/10 border-orange-400/20' },
} as const;

const PRIORITY_STYLE: Record<string, string> = {
  P0: 'bg-red-500/20 text-red-300 border border-red-500/30',
  P1: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30',
  P2: 'bg-gray-500/20 text-gray-400 border border-gray-500/30',
};

function ModuleCard({ module }: { module: Module }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-gray-800/60 border border-gray-700/50 rounded-lg overflow-hidden">
      <button
        className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-700/30 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <span className="mt-0.5 text-gray-500 shrink-0">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-200 truncate">{module.title}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${PRIORITY_STYLE[module.priority] ?? PRIORITY_STYLE.P2}`}>
              {module.priority}
            </span>
          </div>
          {module.desc && (
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{module.desc}</p>
          )}
        </div>
      </button>

      {expanded && module.source_files.length > 0 && (
        <div className="px-4 pb-3 border-t border-gray-700/40">
          <p className="text-xs text-gray-500 mt-2 mb-1.5 font-medium uppercase tracking-wide">来源文件</p>
          <ul className="space-y-1">
            {module.source_files.map(f => (
              <li key={f} className="flex items-center gap-1.5 text-xs text-gray-400 font-mono">
                <FileCode size={11} className="text-gray-600 shrink-0" />
                <span className="truncate">{f}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function KnowledgeModules() {
  const [data, setData] = useState<ModulesData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/brain/knowledge/modules')
      .then(r => r.json())
      .then(setData)
      .catch(e => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="p-8 text-red-400 text-sm">加载失败：{error}</div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-gray-500 text-sm">加载中...</div>
    );
  }

  const groups = (['brain', 'engine', 'system', 'workflows'] as const);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-100">深度知识页</h1>
        {data.meta.total && (
          <p className="text-sm text-gray-500 mt-1">
            共 {data.meta.total} 个模块，已完成 {data.meta.done ?? 0} 个
          </p>
        )}
      </div>

      <div className="space-y-8">
        {groups.map(group => {
          const cfg = GROUP_CONFIG[group];
          const Icon = cfg.icon;
          const modules = data.groups[group] ?? [];

          return (
            <section key={group}>
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border mb-3 ${cfg.bg}`}>
                <Icon size={15} className={cfg.color} />
                <span className={`text-sm font-semibold ${cfg.color}`}>{cfg.label}</span>
                <span className="text-xs text-gray-500 ml-auto">{modules.length} 个模块</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {modules.map(m => (
                  <ModuleCard key={m.id} module={m} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
