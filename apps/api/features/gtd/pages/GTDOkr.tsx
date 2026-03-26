/**
 * GTD OKR — Area 分组全链路树
 * 层级：Area → Objective → KR → Project → Scope → Initiative
 * 数据源: /api/brain/okr/area-tree
 * 支持：inline edit（title / status / priority）
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Target, ChevronRight, ChevronDown, Loader2,
  Layers, BarChart2, FolderKanban, Puzzle, Zap,
  RefreshCw, Check, X as XIcon,
} from 'lucide-react';

// ── 类型 ─────────────────────────────────────────────────────────────────────

interface Initiative {
  id: string;
  title: string;
  status: string;
  priority: string;
  scope_id: string | null;
}

interface Scope {
  id: string;
  title: string;
  status: string;
  priority: string;
  project_id: string | null;
  initiatives: Initiative[];
}

interface OkrProject {
  id: string;
  title: string;
  status: string;
  priority: string;
  kr_id: string | null;
  scopes: Scope[];
}

interface KeyResult {
  id: string;
  title: string;
  status: string;
  priority: string;
  current_value: number | null;
  target_value: number | null;
  unit: string | null;
  projects: OkrProject[];
}

interface Objective {
  id: string;
  title: string;
  status: string;
  priority: string;
  area_id: string | null;
  key_results: KeyResult[];
}

interface Area {
  id: string | null;
  name: string;
  domain: string | null;
  objectives: Objective[];
}

// ── 状态/优先级样式 ───────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  active:      'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25',
  in_progress: 'bg-blue-500/15 text-blue-400 border border-blue-500/25',
  completed:   'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25',
  inactive:    'bg-slate-500/15 text-slate-500 border border-slate-500/25',
  pending:     'bg-slate-500/15 text-slate-400 border border-slate-500/25',
  paused:      'bg-amber-500/15 text-amber-400 border border-amber-500/25',
  archived:    'bg-slate-700/30 text-slate-600 border border-slate-600/25',
  on_track:    'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25',
  at_risk:     'bg-amber-500/15 text-amber-400 border border-amber-500/25',
  off_track:   'bg-red-500/15 text-red-400 border border-red-500/25',
};

const STATUS_LABELS: Record<string, string> = {
  active: '活跃', in_progress: '进行中', completed: '已完成',
  inactive: '未激活', pending: '待开始', paused: '暂停',
  archived: '已归档', on_track: '正常', at_risk: '风险', off_track: '偏轨',
};

const PRIORITY_STYLES: Record<string, string> = {
  P0: 'text-red-400 font-semibold', P1: 'text-amber-400',
  P2: 'text-slate-500', P3: 'text-slate-600',
};

const STATUS_OPTIONS = ['active', 'in_progress', 'pending', 'paused', 'completed', 'inactive', 'archived'];
const PRIORITY_OPTIONS = ['P0', 'P1', 'P2', 'P3'];

// ── Inline Edit 组件 ──────────────────────────────────────────────────────────

function InlineEditTitle({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(value);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commit = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (draft === value) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(draft); } finally { setSaving(false); setEditing(false); }
  };

  const cancel = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <span className="flex items-center gap-1 min-w-0 flex-1" onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-sm text-gray-200 outline-none focus:border-blue-500 min-w-0"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
        />
        {saving ? (
          <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin shrink-0" />
        ) : (
          <>
            <button onClick={commit} className="text-emerald-400 hover:text-emerald-300 shrink-0"><Check className="w-3.5 h-3.5" /></button>
            <button onClick={cancel} className="text-slate-500 hover:text-slate-300 shrink-0"><XIcon className="w-3.5 h-3.5" /></button>
          </>
        )}
      </span>
    );
  }

  return (
    <span
      className="truncate cursor-text hover:underline decoration-dashed decoration-slate-600 underline-offset-2"
      onClick={startEdit}
      title="点击编辑"
    >
      {value}
    </span>
  );
}

function InlineEditStatus({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const select = async (v: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (v === value) { setOpen(false); return; }
    setSaving(true);
    try { await onSave(v); } finally { setSaving(false); setOpen(false); }
  };

  return (
    <div ref={ref} className="relative inline-flex" onClick={e => { e.stopPropagation(); setOpen(!open); }}>
      <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full cursor-pointer hover:opacity-80 ${STATUS_STYLES[value] ?? STATUS_STYLES.pending}`}>
        {saving ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : null}
        {STATUS_LABELS[value] ?? value}
      </span>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-slate-800 border border-slate-700 rounded-lg shadow-xl py-1 min-w-[100px]">
          {STATUS_OPTIONS.map(s => (
            <button
              key={s}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-700 ${s === value ? 'text-white font-semibold' : 'text-slate-300'}`}
              onClick={e => select(s, e)}
            >
              {STATUS_LABELS[s] ?? s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function InlineEditPriority({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const select = async (v: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (v === value) { setOpen(false); return; }
    setSaving(true);
    try { await onSave(v); } finally { setSaving(false); setOpen(false); }
  };

  return (
    <div ref={ref} className="relative inline-flex" onClick={e => { e.stopPropagation(); setOpen(!open); }}>
      <span className={`text-xs cursor-pointer hover:opacity-80 ${PRIORITY_STYLES[value] ?? ''}`}>
        {saving ? <Loader2 className="w-3 h-3 animate-spin inline" /> : value || '—'}
      </span>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-slate-800 border border-slate-700 rounded-lg shadow-xl py-1 min-w-[60px]">
          {PRIORITY_OPTIONS.map(p => (
            <button
              key={p}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-700 ${p === value ? 'text-white font-semibold' : 'text-slate-300'}`}
              onClick={e => select(p, e)}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── API helpers ───────────────────────────────────────────────────────────────

const BRAIN = '/api/brain/okr';

async function patchNode(layer: string, id: string, data: Record<string, string>) {
  const res = await fetch(`${BRAIN}/${layer}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`PATCH failed: ${res.statusText}`);
  return res.json();
}

// ── 状态更新 helpers ──────────────────────────────────────────────────────────

type SetAreasFunc = React.Dispatch<React.SetStateAction<Area[]>>;

function updateObjInAreas(areas: Area[], objId: string, patch: Partial<Objective>): Area[] {
  return areas.map(area => ({
    ...area,
    objectives: area.objectives.map(obj =>
      obj.id === objId ? { ...obj, ...patch } : obj
    ),
  }));
}

function updateKrInAreas(areas: Area[], krId: string, patch: Partial<KeyResult>): Area[] {
  return areas.map(area => ({
    ...area,
    objectives: area.objectives.map(obj => ({
      ...obj,
      key_results: obj.key_results.map(kr =>
        kr.id === krId ? { ...kr, ...patch } : kr
      ),
    })),
  }));
}

function updateProjectInAreas(areas: Area[], projId: string, patch: Partial<OkrProject>): Area[] {
  return areas.map(area => ({
    ...area,
    objectives: area.objectives.map(obj => ({
      ...obj,
      key_results: obj.key_results.map(kr => ({
        ...kr,
        projects: kr.projects.map(p =>
          p.id === projId ? { ...p, ...patch } : p
        ),
      })),
    })),
  }));
}

// ── Initiative 行 ─────────────────────────────────────────────────────────────

function InitiativeRow({ ini, setAreas }: { ini: Initiative; setAreas: SetAreasFunc }) {
  const updateIni = (patch: Partial<Initiative>) =>
    setAreas(prev => prev.map(area => ({
      ...area,
      objectives: area.objectives.map(obj => ({
        ...obj,
        key_results: obj.key_results.map(kr => ({
          ...kr,
          projects: kr.projects.map(p => ({
            ...p,
            scopes: p.scopes.map(s => ({
              ...s,
              initiatives: s.initiatives.map(i =>
                i.id === ini.id ? { ...i, ...patch } : i
              ),
            })),
          })),
        })),
      })),
    })));

  return (
    <div className="flex items-center gap-2 py-1.5 hover:bg-slate-800/30 group" style={{ paddingLeft: '88px', paddingRight: '12px' }}>
      <Zap className="w-3 h-3 text-yellow-500/60 shrink-0" />
      <span className="text-[10px] px-1 py-0.5 rounded font-mono bg-yellow-500/10 text-yellow-500/70 shrink-0">INI</span>
      <InlineEditTitle
        value={ini.title}
        onSave={async (title) => { await patchNode('initiatives', ini.id, { title }); updateIni({ title }); }}
      />
      <div className="ml-auto flex items-center gap-3 shrink-0">
        <InlineEditStatus
          value={ini.status}
          onSave={async (status) => { await patchNode('initiatives', ini.id, { status }); updateIni({ status }); }}
        />
        <InlineEditPriority
          value={ini.priority}
          onSave={async (priority) => { await patchNode('initiatives', ini.id, { priority }); updateIni({ priority }); }}
        />
      </div>
    </div>
  );
}

// ── Scope 行 ──────────────────────────────────────────────────────────────────

function ScopeRow({ scope, setAreas }: { scope: Scope; setAreas: SetAreasFunc }) {
  const [open, setOpen] = useState(false);
  const hasChildren = scope.initiatives.length > 0;

  return (
    <>
      <div
        className="flex items-center gap-2 py-1.5 hover:bg-slate-800/30 cursor-pointer"
        style={{ paddingLeft: '68px', paddingRight: '12px' }}
        onClick={() => hasChildren && setOpen(!open)}
      >
        <span className="w-4 h-4 flex items-center justify-center shrink-0">
          {hasChildren
            ? (open ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />)
            : <span className="w-3" />}
        </span>
        <Puzzle className="w-3 h-3 text-indigo-400/60 shrink-0" />
        <span className="text-[10px] px-1 py-0.5 rounded font-mono bg-indigo-500/10 text-indigo-400/70 shrink-0">SCO</span>
        <InlineEditTitle
          value={scope.title}
          onSave={async (title) => { await patchNode('scopes', scope.id, { title }); }}
        />
        <div className="ml-auto flex items-center gap-3 shrink-0">
          <InlineEditStatus
            value={scope.status}
            onSave={async (status) => { await patchNode('scopes', scope.id, { status }); }}
          />
          <InlineEditPriority
            value={scope.priority}
            onSave={async (priority) => { await patchNode('scopes', scope.id, { priority }); }}
          />
          {hasChildren && <span className="text-[10px] text-slate-600">{scope.initiatives.length}</span>}
        </div>
      </div>
      {open && scope.initiatives.map(ini => (
        <InitiativeRow key={ini.id} ini={ini} setAreas={setAreas} />
      ))}
    </>
  );
}

// ── Project 行 ────────────────────────────────────────────────────────────────

function ProjectRow({ project, setAreas }: { project: OkrProject; setAreas: SetAreasFunc }) {
  const [open, setOpen] = useState(false);
  const hasChildren = project.scopes.length > 0;

  return (
    <>
      <div
        className="flex items-center gap-2 py-1.5 hover:bg-slate-800/30 cursor-pointer"
        style={{ paddingLeft: '48px', paddingRight: '12px' }}
        onClick={() => hasChildren && setOpen(!open)}
      >
        <span className="w-4 h-4 flex items-center justify-center shrink-0">
          {hasChildren
            ? (open ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />)
            : <span className="w-3" />}
        </span>
        <FolderKanban className="w-3.5 h-3.5 text-purple-400/60 shrink-0" />
        <span className="text-[10px] px-1 py-0.5 rounded font-mono bg-purple-500/10 text-purple-400/70 shrink-0">PRJ</span>
        <InlineEditTitle
          value={project.title}
          onSave={async (title) => {
            await patchNode('projects', project.id, { title });
            setAreas(prev => updateProjectInAreas(prev, project.id, { title }));
          }}
        />
        <div className="ml-auto flex items-center gap-3 shrink-0">
          <InlineEditStatus
            value={project.status}
            onSave={async (status) => {
              await patchNode('projects', project.id, { status });
              setAreas(prev => updateProjectInAreas(prev, project.id, { status }));
            }}
          />
          <InlineEditPriority
            value={project.priority}
            onSave={async (priority) => {
              await patchNode('projects', project.id, { priority });
              setAreas(prev => updateProjectInAreas(prev, project.id, { priority }));
            }}
          />
          {hasChildren && <span className="text-[10px] text-slate-600">{project.scopes.length}</span>}
        </div>
      </div>
      {open && project.scopes.map(scope => (
        <ScopeRow key={scope.id} scope={scope} setAreas={setAreas} />
      ))}
    </>
  );
}

// ── KR 行 ─────────────────────────────────────────────────────────────────────

function KRRow({ kr, setAreas }: { kr: KeyResult; setAreas: SetAreasFunc }) {
  const [open, setOpen] = useState(false);
  const hasChildren = kr.projects.length > 0;
  const progress = kr.target_value && Number(kr.target_value) > 0
    ? Math.round((Number(kr.current_value ?? 0) / Number(kr.target_value)) * 100)
    : 0;

  return (
    <>
      <div
        className="flex items-center gap-2 py-1.5 hover:bg-slate-800/40 cursor-pointer"
        style={{ paddingLeft: '28px', paddingRight: '12px' }}
        onClick={() => hasChildren && setOpen(!open)}
      >
        <span className="w-4 h-4 flex items-center justify-center shrink-0">
          {hasChildren
            ? (open ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />)
            : <span className="w-3" />}
        </span>
        <BarChart2 className="w-3.5 h-3.5 text-blue-400/70 shrink-0" />
        <span className="text-[10px] px-1 py-0.5 rounded font-mono bg-blue-500/10 text-blue-400 shrink-0">KR</span>
        <InlineEditTitle
          value={kr.title}
          onSave={async (title) => {
            await patchNode('key-results', kr.id, { title });
            setAreas(prev => updateKrInAreas(prev, kr.id, { title }));
          }}
        />
        <div className="ml-auto flex items-center gap-3 shrink-0">
          {kr.target_value && (
            <span className="text-[11px] text-slate-500">
              {kr.current_value ?? 0}/{kr.target_value}{kr.unit ? ` ${kr.unit}` : ''}
              <span className="ml-1 text-blue-400/70">{progress}%</span>
            </span>
          )}
          <InlineEditStatus
            value={kr.status}
            onSave={async (status) => {
              await patchNode('key-results', kr.id, { status });
              setAreas(prev => updateKrInAreas(prev, kr.id, { status }));
            }}
          />
          <InlineEditPriority
            value={kr.priority}
            onSave={async (priority) => {
              await patchNode('key-results', kr.id, { priority });
              setAreas(prev => updateKrInAreas(prev, kr.id, { priority }));
            }}
          />
          {hasChildren && <span className="text-[10px] text-slate-600">{kr.projects.length}</span>}
        </div>
      </div>
      {open && kr.projects.map(proj => (
        <ProjectRow key={proj.id} project={proj} setAreas={setAreas} />
      ))}
    </>
  );
}

// ── Objective 行 ──────────────────────────────────────────────────────────────

function ObjectiveRow({ obj, setAreas }: { obj: Objective; setAreas: SetAreasFunc }) {
  const [open, setOpen] = useState(true);
  const hasChildren = obj.key_results.length > 0;

  return (
    <>
      <div
        className="flex items-center gap-2 py-2 hover:bg-slate-800/50 cursor-pointer"
        style={{ paddingLeft: '12px', paddingRight: '12px' }}
        onClick={() => setOpen(!open)}
      >
        <span className="w-4 h-4 flex items-center justify-center shrink-0">
          {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
        </span>
        <Target className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
        <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-indigo-500/10 text-indigo-400 shrink-0">OBJ</span>
        <InlineEditTitle
          value={obj.title}
          onSave={async (title) => {
            await patchNode('objectives', obj.id, { title });
            setAreas(prev => updateObjInAreas(prev, obj.id, { title }));
          }}
        />
        <div className="ml-auto flex items-center gap-3 shrink-0">
          <InlineEditStatus
            value={obj.status}
            onSave={async (status) => {
              await patchNode('objectives', obj.id, { status });
              setAreas(prev => updateObjInAreas(prev, obj.id, { status }));
            }}
          />
          <InlineEditPriority
            value={obj.priority}
            onSave={async (priority) => {
              await patchNode('objectives', obj.id, { priority });
              setAreas(prev => updateObjInAreas(prev, obj.id, { priority }));
            }}
          />
          {hasChildren && <span className="text-[10px] text-slate-600">{obj.key_results.length} KR</span>}
        </div>
      </div>
      {open && obj.key_results.map(kr => (
        <KRRow key={kr.id} kr={kr} setAreas={setAreas} />
      ))}
    </>
  );
}

// ── Area 块 ───────────────────────────────────────────────────────────────────

const DOMAIN_COLORS: Record<string, string> = {
  Work:   'text-blue-400',
  Study:  'text-purple-400',
  Life:   'text-green-400',
  System: 'text-slate-400',
};

function AreaBlock({ area, setAreas }: { area: Area; setAreas: SetAreasFunc }) {
  const [open, setOpen] = useState(true);
  const color = DOMAIN_COLORS[area.domain ?? ''] ?? 'text-slate-400';

  return (
    <div className="border border-slate-700/50 rounded-xl overflow-hidden mb-3">
      <div
        className="flex items-center gap-3 px-4 py-3 bg-slate-800/50 cursor-pointer hover:bg-slate-800/70 select-none"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
        <Layers className={`w-4 h-4 ${color}`} />
        <span className="font-semibold text-sm text-gray-200">{area.name}</span>
        {area.domain && (
          <span className={`text-[11px] px-2 py-0.5 rounded-full border bg-transparent ${
            area.domain === 'Work'   ? 'border-blue-500/30 text-blue-400' :
            area.domain === 'Study' ? 'border-purple-500/30 text-purple-400' :
            area.domain === 'Life'  ? 'border-green-500/30 text-green-400' :
            'border-slate-600 text-slate-500'
          }`}>{area.domain}</span>
        )}
        <span className="ml-auto text-[11px] text-slate-500">{area.objectives.length} Objective</span>
      </div>
      {open && (
        <div className="divide-y divide-slate-800/60">
          {area.objectives.map(obj => (
            <ObjectiveRow key={obj.id} obj={obj} setAreas={setAreas} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

export default function GTDOkr() {
  const [areas, setAreas] = useState<Area[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/brain/okr/area-tree');
      const data = res.ok ? await res.json() : { areas: [] };
      setAreas(data.areas || []);
    } catch {
      setAreas([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filteredAreas = search.trim()
    ? areas.map(area => ({
        ...area,
        objectives: area.objectives.filter(obj =>
          obj.title.toLowerCase().includes(search.toLowerCase()) ||
          obj.key_results.some(kr => kr.title.toLowerCase().includes(search.toLowerCase()))
        ),
      })).filter(area => area.objectives.length > 0)
    : areas;

  const totalObjs = areas.reduce((s, a) => s + a.objectives.length, 0);
  const totalKRs = areas.reduce((s, a) =>
    s + a.objectives.reduce((ss, o) => ss + o.key_results.length, 0), 0
  );
  const totalProjects = areas.reduce((s, a) =>
    s + a.objectives.reduce((ss, o) =>
      ss + o.key_results.reduce((sss, kr) => sss + kr.projects.length, 0), 0
    ), 0
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700/50 shrink-0">
        <Target className="w-4 h-4 text-slate-400" />
        <span className="text-sm font-semibold text-gray-300">OKR Tree</span>
        <div className="flex-1">
          <input
            className="w-full max-w-xs bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 placeholder-slate-600 outline-none focus:border-slate-500"
            placeholder="搜索 OKR..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <button
          onClick={fetchData}
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-700/50"
          title="刷新"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <div className="flex items-center gap-3 text-[11px] text-slate-500">
          <span>{filteredAreas.length} Area</span>
          <span>{totalObjs} Obj</span>
          <span>{totalKRs} KR</span>
          <span>{totalProjects} Proj</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
          </div>
        ) : filteredAreas.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-500 text-sm">
            {search ? '没有匹配的 OKR' : '暂无 OKR 数据'}
          </div>
        ) : (
          filteredAreas.map(area => (
            <AreaBlock key={area.id ?? 'unassigned'} area={area} setAreas={setAreas} />
          ))
        )}
      </div>
    </div>
  );
}
