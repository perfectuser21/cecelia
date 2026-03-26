/**
 * GTD OKR — 聚焦 OKR 视图（Vision → Area → Objective → KR）
 * 数据源: /api/tasks/full-tree?view=okr
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Target, ChevronRight, ChevronDown, Loader2, Calendar, User, Pencil, Check, X } from 'lucide-react';

// ─── 类型配置 ────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<string, { label: string; cls: string }> = {
  vision:    { label: 'VISION', cls: 'bg-amber-500/20 text-amber-300 border border-amber-500/30' },
  area:      { label: 'AREA',   cls: 'bg-violet-500/15 text-violet-400' },
  objective: { label: 'OBJ',    cls: 'bg-purple-500/15 text-purple-400' },
  kr:        { label: 'KR',     cls: 'bg-blue-500/15 text-blue-400' },
};

const STATUS_OPTIONS = ['active', 'in_progress', 'pending', 'completed', 'paused'];
const STATUS_LABELS: Record<string, string> = {
  active: '活跃', in_progress: '进行中', pending: '待开始', completed: '已完成', paused: '暂停',
};
const STATUS_STYLES: Record<string, string> = {
  active:      'bg-emerald-500/15 text-emerald-400',
  in_progress: 'bg-blue-500/15 text-blue-400',
  completed:   'bg-emerald-500/15 text-emerald-400',
  pending:     'bg-slate-500/15 text-slate-400',
  paused:      'bg-amber-500/15 text-amber-400',
};

// ─── 数据类型 ─────────────────────────────────────────────────────────────────

interface OkrNode {
  id: string;
  title?: string;
  name?: string;
  status: string;
  type: string;
  start_date?: string | null;
  end_date?: string | null;
  description?: string | null;
  owner_role?: string | null;
  priority?: string | null;
  // KR only
  current_value?: number;
  target_value?: number;
  unit?: string;
  progress?: number;
  children: OkrNode[];
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function fmt(d?: string | null) {
  return d ? d.slice(0, 10) : null;
}

function nodeTitle(node: OkrNode) {
  return node.title || node.name || '(无标题)';
}

// ─── Description 内联编辑 ──────────────────────────────────────────────────────

function DescriptionEditor({
  nodeType, nodeId, initial, onSaved,
}: {
  nodeType: string;
  nodeId: string;
  initial: string | null | undefined;
  onSaved: (val: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial ?? '');
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleEdit = () => {
    setEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`/api/tasks/full-tree/${nodeType}/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: value }),
      });
      onSaved(value);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setValue(initial ?? '');
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="mt-1.5 flex flex-col gap-1">
        <textarea
          ref={textareaRef}
          className="w-full text-xs bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-gray-300 focus:outline-none focus:border-slate-500 resize-none"
          rows={3}
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="添加备注..."
        />
        <div className="flex gap-1.5">
          <button
            className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30"
            onClick={handleSave}
            disabled={saving}
          >
            <Check className="w-3 h-3" />
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-slate-700 text-slate-400 hover:bg-slate-600"
            onClick={handleCancel}
          >
            <X className="w-3 h-3" />
            取消
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-1.5 mt-1">
      {value ? (
        <p className="flex-1 text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">{value}</p>
      ) : (
        <span className="flex-1 text-xs text-slate-600 italic">暂无备注</span>
      )}
      <button
        className="shrink-0 text-slate-600 hover:text-slate-400 mt-0.5"
        onClick={handleEdit}
        title="编辑备注"
      >
        <Pencil className="w-3 h-3" />
      </button>
    </div>
  );
}

// ─── KR 行 ────────────────────────────────────────────────────────────────────

function KrRow({ node, onDescSaved }: { node: OkrNode; onDescSaved: (id: string, val: string) => void }) {
  const [showDesc, setShowDesc] = useState(false);
  const [status, setStatus] = useState(node.status);
  const [editingStatus, setEditingStatus] = useState(false);
  const [saving, setSaving] = useState(false);

  const start = fmt(node.start_date);
  const end = fmt(node.end_date);

  const handleStatusChange = async (newStatus: string) => {
    if (newStatus === status) { setEditingStatus(false); return; }
    setSaving(true);
    try {
      await fetch(`/api/tasks/full-tree/kr/${node.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      setStatus(newStatus);
    } finally {
      setSaving(false);
      setEditingStatus(false);
    }
  };

  return (
    <div className="ml-6 border-l border-slate-700/50 pl-4 py-2">
      <div className="flex items-center gap-2 text-sm">
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ${TYPE_CONFIG.kr.cls}`}>
          KR
        </span>
        <span className="flex-1 text-gray-300 text-xs">{nodeTitle(node)}</span>

        {/* 进度 */}
        {node.target_value !== undefined && node.target_value !== null && (
          <span className="text-[11px] text-slate-400 shrink-0 tabular-nums">
            {node.current_value ?? 0} / {node.target_value}{node.unit ? ` ${node.unit}` : ''}
          </span>
        )}
        {node.progress !== undefined && (
          <span className="text-[11px] text-blue-400 tabular-nums shrink-0 w-10 text-right">
            {node.progress}%
          </span>
        )}

        {/* 日期 */}
        {(start || end) && (
          <span className="flex items-center gap-1 text-[11px] text-slate-500 shrink-0">
            <Calendar className="w-3 h-3" />
            {start ?? '?'} → {end ?? '?'}
          </span>
        )}

        {/* owner */}
        {node.owner_role && (
          <span className="flex items-center gap-1 text-[11px] text-slate-400 shrink-0 max-w-[100px] truncate">
            <User className="w-3 h-3 shrink-0" />
            {node.owner_role}
          </span>
        )}

        {/* 备注展开 */}
        <button
          className="shrink-0 text-slate-600 hover:text-slate-400"
          onClick={() => setShowDesc(s => !s)}
          title="查看/编辑备注"
        >
          <Pencil className="w-3 h-3" />
        </button>

        {/* status */}
        <div className="shrink-0">
          {editingStatus ? (
            <select
              autoFocus
              className="text-xs bg-slate-700 border border-slate-600 rounded px-1.5 py-0.5 text-gray-300 focus:outline-none"
              defaultValue={status}
              onBlur={() => setEditingStatus(false)}
              onChange={e => handleStatusChange(e.target.value)}
            >
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          ) : (
            <button
              className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_STYLES[status] ?? STATUS_STYLES.pending} ${saving ? 'opacity-50' : ''}`}
              onClick={() => setEditingStatus(true)}
              title="点击修改状态"
            >
              {saving ? '...' : (STATUS_LABELS[status] ?? status)}
            </button>
          )}
        </div>
      </div>

      {/* 进度条 */}
      {node.progress !== undefined && node.progress > 0 && (
        <div className="ml-[52px] mt-1 h-1 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all"
            style={{ width: `${Math.min(node.progress, 100)}%` }}
          />
        </div>
      )}

      {/* Description 编辑 */}
      {showDesc && (
        <div className="ml-[52px] mt-1">
          <DescriptionEditor
            nodeType="kr"
            nodeId={node.id}
            initial={node.description}
            onSaved={val => onDescSaved(node.id, val)}
          />
        </div>
      )}
    </div>
  );
}

// ─── Objective 行 ─────────────────────────────────────────────────────────────

function ObjectiveRow({ node, onDescSaved }: { node: OkrNode; onDescSaved: (id: string, val: string) => void }) {
  const [expanded, setExpanded] = useState(true);
  const [showDesc, setShowDesc] = useState(false);
  const [status, setStatus] = useState(node.status);
  const [editingStatus, setEditingStatus] = useState(false);
  const [saving, setSaving] = useState(false);

  const start = fmt(node.start_date);
  const end = fmt(node.end_date);
  const hasKrs = node.children.length > 0;

  const handleStatusChange = async (newStatus: string) => {
    if (newStatus === status) { setEditingStatus(false); return; }
    setSaving(true);
    try {
      await fetch(`/api/tasks/full-tree/objective/${node.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      setStatus(newStatus);
    } finally {
      setSaving(false);
      setEditingStatus(false);
    }
  };

  return (
    <div className="border-l border-slate-700/40 ml-4 pl-3 mb-2">
      {/* Objective 主行 */}
      <div className="flex items-start gap-2 py-1.5">
        <button
          className="mt-0.5 w-4 h-4 shrink-0 text-slate-500 hover:text-slate-300"
          onClick={() => hasKrs && setExpanded(e => !e)}
        >
          {hasKrs
            ? expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />
            : <span className="w-3.5 h-3.5 block" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ${TYPE_CONFIG.objective.cls}`}>
              OBJ
            </span>
            <span className="text-sm text-gray-200 font-medium">{nodeTitle(node)}</span>

            {/* 日期 */}
            {(start || end) && (
              <span className="flex items-center gap-1 text-[11px] text-slate-500">
                <Calendar className="w-3 h-3" />
                {start ?? '?'} → {end ?? '?'}
              </span>
            )}
            {node.owner_role && (
              <span className="flex items-center gap-1 text-[11px] text-slate-400 max-w-[120px] truncate">
                <User className="w-3 h-3 shrink-0" />
                {node.owner_role}
              </span>
            )}
            {node.priority && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">{node.priority}</span>
            )}

            {/* 备注按钮 */}
            <button
              className="text-slate-600 hover:text-slate-400"
              onClick={() => setShowDesc(s => !s)}
              title="查看/编辑备注"
            >
              <Pencil className="w-3 h-3" />
            </button>

            {/* status */}
            <div className="shrink-0">
              {editingStatus ? (
                <select
                  autoFocus
                  className="text-xs bg-slate-700 border border-slate-600 rounded px-1.5 py-0.5 text-gray-300 focus:outline-none"
                  defaultValue={status}
                  onBlur={() => setEditingStatus(false)}
                  onChange={e => handleStatusChange(e.target.value)}
                >
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              ) : (
                <button
                  className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_STYLES[status] ?? STATUS_STYLES.pending} ${saving ? 'opacity-50' : ''}`}
                  onClick={() => setEditingStatus(true)}
                >
                  {saving ? '...' : (STATUS_LABELS[status] ?? status)}
                </button>
              )}
            </div>

            {hasKrs && (
              <span className="text-[10px] text-slate-600">{node.children.length} KR</span>
            )}
          </div>

          {/* Description */}
          {showDesc && (
            <DescriptionEditor
              nodeType="objective"
              nodeId={node.id}
              initial={node.description}
              onSaved={val => onDescSaved(node.id, val)}
            />
          )}
        </div>
      </div>

      {/* KR 列表 */}
      {expanded && hasKrs && (
        <div>
          {node.children.map(kr => (
            <KrRow key={kr.id} node={kr} onDescSaved={onDescSaved} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Area Section ─────────────────────────────────────────────────────────────

function AreaSection({ node, onDescSaved }: { node: OkrNode; onDescSaved: (id: string, val: string) => void }) {
  const [expanded, setExpanded] = useState(true);
  const hasObjs = node.children.length > 0;

  return (
    <div className="mb-4">
      {/* Area 标题行 */}
      <button
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/40 hover:bg-slate-800/60 transition-colors text-left"
        onClick={() => hasObjs && setExpanded(e => !e)}
      >
        {hasObjs
          ? expanded ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          : <span className="w-4 h-4 shrink-0" />}
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ${TYPE_CONFIG.area.cls}`}>
          AREA
        </span>
        <span className="text-sm font-semibold text-gray-100">{nodeTitle(node)}</span>
        {hasObjs && (
          <span className="text-[11px] text-slate-500 ml-1">{node.children.length} 个目标</span>
        )}
      </button>

      {/* Objectives */}
      {expanded && hasObjs && (
        <div className="mt-2 pl-2">
          {node.children.map(obj => (
            <ObjectiveRow key={obj.id} node={obj} onDescSaved={onDescSaved} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Vision Section ───────────────────────────────────────────────────────────

function VisionSection({ node, onDescSaved }: { node: OkrNode; onDescSaved: (id: string, val: string) => void }) {
  const [showDesc, setShowDesc] = useState(false);

  return (
    <div className="mb-6">
      {/* Vision 标题 */}
      <div className="flex items-start gap-3 px-4 py-3 bg-amber-500/5 border border-amber-500/20 rounded-xl mb-4">
        <span className={`text-[11px] px-2 py-1 rounded font-mono shrink-0 mt-0.5 ${TYPE_CONFIG.vision.cls}`}>
          VISION
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-amber-100">{nodeTitle(node)}</h2>
          {node.status && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_STYLES[node.status] ?? STATUS_STYLES.active}`}>
              {STATUS_LABELS[node.status] ?? node.status}
            </span>
          )}
          {/* Vision description */}
          <button
            className="mt-1 flex items-center gap-1 text-[11px] text-amber-600/70 hover:text-amber-500/90"
            onClick={() => setShowDesc(s => !s)}
          >
            <Pencil className="w-3 h-3" />
            {showDesc ? '收起备注' : '查看/编辑备注'}
          </button>
          {showDesc && (
            <div className="mt-1">
              <DescriptionEditor
                nodeType="vision"
                nodeId={node.id}
                initial={node.description}
                onSaved={val => onDescSaved(node.id, val)}
              />
            </div>
          )}
        </div>
        <span className="text-[11px] text-slate-500 shrink-0 mt-1">{node.children.length} 个 Area</span>
      </div>

      {/* Area sections */}
      {node.children.map(area => (
        <AreaSection key={area.id} node={area} onDescSaved={onDescSaved} />
      ))}
    </div>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export default function GTDOkr() {
  const [tree, setTree] = useState<OkrNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tasks/full-tree?view=okr');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `HTTP ${res.status}`);
        setTree([]);
      } else {
        setTree(await res.json());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误');
      setTree([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 本地更新 description（避免全量重载）
  const handleDescSaved = useCallback((nodeId: string, val: string) => {
    setTree(prev => updateDesc(prev, nodeId, val));
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-900">
      {/* 工具栏 */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-slate-800">
        <Target className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-medium text-gray-200">OKR 视图</span>
        {!loading && !error && (
          <span className="text-xs text-slate-500">
            {tree.length} 个 Vision · {tree.reduce((n, v) => n + v.children.length, 0)} 个 Area
          </span>
        )}
        <button
          className="ml-auto text-xs text-slate-500 hover:text-slate-300"
          onClick={fetchData}
        >
          刷新
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-auto px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            加载中...
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-32 text-red-400 text-sm">
            加载失败：{error}
          </div>
        ) : tree.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
            暂无 OKR 数据
          </div>
        ) : (
          tree.map(vision => (
            <VisionSection key={vision.id} node={vision} onDescSaved={handleDescSaved} />
          ))
        )}
      </div>

      {/* 底部提示 */}
      {!loading && !error && tree.length > 0 && (
        <div className="shrink-0 px-4 py-2 text-xs text-slate-600 border-t border-slate-800">
          点击状态可编辑 · 点击 <Pencil className="w-3 h-3 inline" /> 编辑备注
        </div>
      )}
    </div>
  );
}

// ─── 工具：递归更新 description ──────────────────────────────────────────────

function updateDesc(nodes: OkrNode[], id: string, val: string): OkrNode[] {
  return nodes.map(n => {
    if (n.id === id) return { ...n, description: val };
    if (n.children.length > 0) return { ...n, children: updateDesc(n.children, id, val) };
    return n;
  });
}
