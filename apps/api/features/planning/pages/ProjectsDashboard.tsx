/**
 * Projects Dashboard - 层级视图：Project → Initiative（可展开/折叠）
 * 数据源: /api/tasks/projects + /api/tasks/areas
 */

import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronDown, BarChart2 } from 'lucide-react';

interface Area {
  id: string;
  name: string;
  domain: string | null;
}

interface Project {
  id: string;
  name: string;
  type: string;
  status: string;
  priority: string;
  progress?: number;
  parent_id: string | null;
  kr_id: string | null;
  goal_id: string | null;
  area_id: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  active:      'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  in_progress: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  pending:     'bg-slate-500/20 text-slate-400 border border-slate-500/30',
  completed:   'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  paused:      'bg-amber-500/20 text-amber-300 border border-amber-500/30',
};

const STATUS_LABELS: Record<string, string> = {
  active:      '活跃',
  in_progress: '进行中',
  pending:     '待开始',
  completed:   '已完成',
  paused:      '暂停',
};

const PRIORITY_COLORS: Record<string, string> = {
  P0: 'text-red-400 font-semibold',
  P1: 'text-amber-400',
  P2: 'text-slate-500',
};

function ProgressBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value || 0));
  return (
    <div className="flex items-center gap-2 w-24">
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className="h-full bg-purple-500 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-400 w-8 text-right">{pct}%</span>
    </div>
  );
}

export default function ProjectsDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [projectsRes, areasRes] = await Promise.all([
        fetch('/api/tasks/projects?limit=2000'),
        fetch('/api/tasks/areas'),
      ]);
      const projectList: Project[] = projectsRes.ok ? await projectsRes.json() : [];
      const areaList: Area[] = areasRes.ok ? await areasRes.json() : [];
      setProjects(projectList);
      setAreas(areaList);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleCollapse = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const areaMap = new Map(areas.map(a => [a.id, a.name]));

  const parentProjects = projects.filter(p => p.type === 'project');
  const initiatives    = projects.filter(p => p.type === 'initiative');

  // 排序：P0 → P1 → P2
  const po: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
  parentProjects.sort((a, b) => (po[a.priority] ?? 9) - (po[b.priority] ?? 9));

  if (loading) return <div className="h-full flex items-center justify-center text-slate-500 text-sm">加载中…</div>;

  const rowBase = 'flex items-center gap-3 px-4 py-2 border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors text-sm';

  const renderInitiative = (ini: Project) => {
    const areaName = ini.area_id ? (areaMap.get(ini.area_id) ?? '—') : '—';
    return (
      <div key={ini.id} className={`${rowBase} pl-10 bg-slate-900/30`}>
        <div className="w-4 shrink-0 flex justify-center">
          <div className="w-1 h-1 rounded-full bg-blue-400/60" />
        </div>
        <div className="flex-1 min-w-0 truncate text-gray-300 text-xs">{ini.name}</div>
        <span className="text-xs text-slate-600 w-24 truncate text-right shrink-0">{areaName}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[ini.status] ?? STATUS_COLORS.pending}`}>
          {STATUS_LABELS[ini.status] ?? ini.status}
        </span>
        <span className={`text-xs w-6 text-right shrink-0 ${PRIORITY_COLORS[ini.priority] ?? ''}`}>{ini.priority}</span>
        <ProgressBar value={ini.progress ?? 0} />
      </div>
    );
  };

  const renderProject = (proj: Project) => {
    const myInitiatives = initiatives.filter(i => i.parent_id === proj.id);
    const isCollapsed = collapsed.has(proj.id);
    const areaName = proj.area_id ? (areaMap.get(proj.area_id) ?? '—') : '—';

    return (
      <div key={proj.id}>
        <div
          className={`${rowBase} bg-slate-800/10 cursor-pointer`}
          onClick={() => myInitiatives.length > 0 && toggleCollapse(proj.id)}
        >
          <span className="w-4 shrink-0 text-slate-500 flex items-center">
            {myInitiatives.length > 0
              ? (isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)
              : <span className="w-3.5 h-3.5 block" />}
          </span>
          <div className="flex-1 min-w-0 truncate text-gray-100 font-medium">{proj.name}</div>
          <span className="text-xs text-slate-500 w-24 truncate text-right shrink-0">{areaName}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[proj.status] ?? STATUS_COLORS.pending}`}>
            {STATUS_LABELS[proj.status] ?? proj.status}
          </span>
          <span className={`text-xs w-6 text-right shrink-0 ${PRIORITY_COLORS[proj.priority] ?? ''}`}>{proj.priority}</span>
          <ProgressBar value={proj.progress ?? 0} />
        </div>

        {!isCollapsed && myInitiatives.map(ini => renderInitiative(ini))}
      </div>
    );
  };

  // 无父项目的 initiatives（孤立）
  const projectIds = new Set(parentProjects.map(p => p.id));
  const orphanInitiatives = initiatives.filter(i => !i.parent_id || !projectIds.has(i.parent_id));

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 表头 */}
      <div className="flex items-center gap-3 px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-800 bg-slate-900/50">
        <span className="w-4 shrink-0" />
        <span className="flex-1">项目名称</span>
        <span className="w-24 text-right">Area</span>
        <span className="w-16 text-right">状态</span>
        <span className="w-6 text-right">P</span>
        <span className="w-24 text-right">进度</span>
      </div>

      <div className="flex-1 overflow-auto">
        {parentProjects.map(proj => renderProject(proj))}

        {orphanInitiatives.length > 0 && (
          <>
            <div className="px-4 py-2 text-xs text-slate-600 uppercase tracking-wider border-b border-slate-800 bg-slate-900/30">
              独立 Initiatives（未关联 Project）
            </div>
            {orphanInitiatives.map(ini => renderInitiative(ini))}
          </>
        )}

        {projects.length === 0 && (
          <div className="flex items-center justify-center h-24 text-slate-500 text-sm">暂无 Project 数据</div>
        )}
      </div>

      <div className="shrink-0 px-4 py-2 text-xs text-slate-600 border-t border-slate-800 flex items-center gap-4">
        <span>{parentProjects.length} 个 Project</span>
        <span>{initiatives.length} 个 Initiative</span>
        <span>{initiatives.filter(i => i.status === 'in_progress' || i.status === 'active').length} 个活跃</span>
        <a
          href="/projects/compare"
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 hover:text-purple-300 transition-colors"
        >
          <BarChart2 className="w-3 h-3" />
          <span>对比项目</span>
        </a>
      </div>
    </div>
  );
}
