/**
 * Area OKR Detail - 展示某个 Area 的所有 KR 和关联 Projects
 * 数据源: /api/tasks/goals + /api/tasks/projects
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, FolderOpen } from 'lucide-react';
import { DatabaseView } from '../../shared/components/DatabaseView';
import type { ColumnDef } from '../../shared/components/DatabaseView';

interface Goal {
  id: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  progress: number;
  weight: number;
  parent_id: string | null;
  custom_props: Record<string, unknown>;
}

interface Project {
  id: string;
  name: string;
  type: string;
  status: string;
  priority: string;
  progress?: number;
  kr_id: string | null;
  goal_id: string | null;
  parent_id: string | null;
}

interface KRRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  progress: number;
  weight: number;
  [key: string]: unknown;
}

interface ProjectRow {
  id: string;
  type_label: string;
  name: string;
  status: string;
  priority: string;
  progress: number;
}

const KR_COLUMNS: ColumnDef[] = [
  { id: 'title', label: 'KR 名称', type: 'text', editable: true, sortable: true, width: 400 },
  { id: 'priority', label: '优先级', type: 'badge', editable: true, sortable: true, width: 90,
    options: [
      { value: 'P0', label: 'P0', color: '#ef4444' },
      { value: 'P1', label: 'P1', color: '#f59e0b' },
      { value: 'P2', label: 'P2', color: '#6b7280' },
    ],
  },
  { id: 'status', label: '状态', type: 'badge', editable: true, sortable: true, width: 110,
    options: [
      { value: 'pending', label: '待开始', color: '#6b7280' },
      { value: 'in_progress', label: '进行中', color: '#3b82f6' },
      { value: 'completed', label: '已完成', color: '#10b981' },
      { value: 'paused', label: '暂停', color: '#f59e0b' },
    ],
  },
  { id: 'progress', label: '进度', type: 'progress', editable: true, sortable: true, width: 140 },
  { id: 'weight', label: '权重', type: 'number', editable: true, sortable: true, width: 80 },
];

const PROJECT_COLUMNS: ColumnDef[] = [
  { id: 'type_label', label: '类型', type: 'badge', sortable: true, width: 100,
    options: [
      { value: 'project', label: 'Project', color: '#8b5cf6' },
      { value: 'initiative', label: 'Initiative', color: '#3b82f6' },
    ],
  },
  { id: 'name', label: '名称', type: 'text', editable: true, sortable: true, width: 300 },
  { id: 'status', label: '状态', type: 'badge', editable: true, sortable: true, width: 110,
    options: [
      { value: 'active', label: '活跃', color: '#10b981' },
      { value: 'in_progress', label: '进行中', color: '#3b82f6' },
      { value: 'pending', label: '待开始', color: '#6b7280' },
      { value: 'completed', label: '已完成', color: '#10b981' },
      { value: 'paused', label: '暂停', color: '#f59e0b' },
    ],
  },
  { id: 'priority', label: '优先级', type: 'badge', editable: true, sortable: true, width: 90,
    options: [
      { value: 'P0', label: 'P0', color: '#ef4444' },
      { value: 'P1', label: 'P1', color: '#f59e0b' },
      { value: 'P2', label: 'P2', color: '#6b7280' },
    ],
  },
  { id: 'progress', label: '进度 %', type: 'number', editable: true, sortable: true, width: 90 },
];

const KR_FIELD_IDS = KR_COLUMNS.map(c => c.id);

export default function AreaOKRDetail() {
  const { areaId } = useParams<{ areaId: string }>();
  const navigate = useNavigate();
  const [area, setArea] = useState<Goal | null>(null);
  const [krRows, setKrRows] = useState<KRRow[]>([]);
  const [projectRows, setProjectRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!areaId) return;
    setLoading(true);
    try {
      const [areaRes, allGoalsRes, allProjectsRes] = await Promise.all([
        fetch(`/api/tasks/goals/${areaId}`),
        fetch('/api/tasks/goals'),
        fetch('/api/tasks/projects'),
      ]);
      if (!areaRes.ok) { setArea(null); setKrRows([]); setProjectRows([]); return; }

      const areaGoal: Goal = await areaRes.json();
      setArea(areaGoal);

      const allGoals: Goal[] = allGoalsRes.ok ? await allGoalsRes.json() : [];
      const allProjects: Project[] = allProjectsRes.ok ? await allProjectsRes.json() : [];

      // KR：直接 parent_id = areaId 的 goals
      const krs = allGoals.filter(g => g.type === 'kr' && g.parent_id === areaId);
      const krIds = new Set(krs.map(k => k.id));

      setKrRows(krs.map(g => ({
        id: g.id,
        title: g.title,
        status: g.status,
        priority: g.priority ?? 'P2',
        progress: g.progress ?? 0,
        weight: g.weight ?? 1,
        ...(g.custom_props ?? {}),
      })));

      // Projects：关联到这个 Area 的 KR 的 projects/initiatives
      const linkedProjects = allProjects.filter(p => {
        const kr = p.kr_id || p.goal_id;
        if (kr && krIds.has(kr)) return true;
        // Initiative 的 parent_id 是 Project，Project 可能关联到这个 area 的 KR
        if (p.type === 'initiative' && p.parent_id) {
          const parentProj = allProjects.find(pp => pp.id === p.parent_id);
          if (parentProj) {
            const parentKr = parentProj.kr_id || parentProj.goal_id;
            if (parentKr && krIds.has(parentKr)) return true;
          }
        }
        return false;
      });

      setProjectRows(linkedProjects.map(p => ({
        id: p.id,
        type_label: p.type,
        name: p.name,
        status: p.status,
        priority: p.priority ?? 'P2',
        progress: p.progress ?? 0,
      })));
    } catch { setArea(null); setKrRows([]); setProjectRows([]); }
    finally { setLoading(false); }
  }, [areaId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleKRUpdate = useCallback(async (id: string, field: string, value: unknown) => {
    const isCustom = !KR_FIELD_IDS.includes(field);
    const body = isCustom ? { custom_props: { [field]: value } } : { [field]: value };
    await fetch(`/api/tasks/goals/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setKrRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }, []);

  const handleProjectUpdate = useCallback(async (id: string, field: string, value: unknown) => {
    await fetch(`/api/tasks/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    setProjectRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }, []);

  if (!loading && !area) {
    return (
      <div className="h-full flex flex-col bg-slate-900 text-gray-200 p-6">
        <button onClick={() => navigate('/work')} className="flex items-center gap-2 text-slate-400 hover:text-white mb-6 transition-colors">
          <ChevronLeft className="w-4 h-4" /> 返回
        </button>
        <div className="text-center py-16 text-slate-500">Area 未找到</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-900 overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-4 pb-3 border-b border-slate-700/50 shrink-0">
        <button onClick={() => navigate('/work')} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors mb-3">
          <ChevronLeft className="w-3.5 h-3.5" /> Area 总览
        </button>
        <h1 className="text-lg font-semibold text-gray-100 truncate">
          {area?.title ?? '加载中...'}
        </h1>
        <div className="flex items-center gap-4 mt-1 text-xs text-slate-400">
          <span>{krRows.length} 个 KR</span>
          <span>活跃 KR {krRows.filter(r => r.status === 'in_progress').length}</span>
          <span>{projectRows.length} 个 Project</span>
          {area?.progress !== undefined && <span>总进度 {area.progress}%</span>}
        </div>
      </div>

      {/* KR 列表 */}
      <div className="shrink-0" style={{ maxHeight: '45%' }}>
        <div className="px-6 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
          关键结果（KR）
        </div>
        <DatabaseView
          data={krRows}
          columns={KR_COLUMNS}
          onUpdate={handleKRUpdate}
          loading={loading}
          defaultView="table"
          stateKey={`area-kr-${areaId}`}
          boardGroupField="status"
          stats={{ total: krRows.length, byStatus: {
            in_progress: krRows.filter(r => r.status === 'in_progress').length || undefined,
          }}}
        />
      </div>

      {/* Projects 关联列表 */}
      <div className="flex-1 overflow-hidden border-t border-slate-700/50">
        <div className="px-6 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800 flex items-center gap-2">
          <FolderOpen className="w-3.5 h-3.5" />
          关联 Projects
        </div>
        {projectRows.length === 0 && !loading ? (
          <div className="flex items-center justify-center h-24 text-slate-500 text-sm">暂无关联 Project</div>
        ) : (
          <DatabaseView
            data={projectRows}
            columns={PROJECT_COLUMNS}
            onUpdate={handleProjectUpdate}
            loading={loading}
            defaultView="table"
            stateKey={`area-projects-${areaId}`}
            stats={{ total: projectRows.length }}
          />
        )}
      </div>
    </div>
  );
}
