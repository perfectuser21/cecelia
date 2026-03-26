/**
 * GTD OKR — 完整 OKR 层级树（Area → Objective → KR → Project → Scope → Initiative）
 * 数据源: /api/tasks/full-tree
 */

import { useState, useEffect, useCallback } from 'react';
import { Target, ChevronRight, ChevronDown, Loader2 } from 'lucide-react';

const TYPE_CONFIG: Record<string, { label: string; cls: string }> = {
  area:       { label: 'AREA', cls: 'bg-violet-500/15 text-violet-400' },
  objective:  { label: 'OBJ',  cls: 'bg-purple-500/15 text-purple-400' },
  kr:         { label: 'KR',   cls: 'bg-blue-500/15 text-blue-400' },
  project:    { label: 'PRJ',  cls: 'bg-emerald-500/15 text-emerald-400' },
  scope:      { label: 'SCP',  cls: 'bg-yellow-500/15 text-yellow-500' },
  initiative: { label: 'INI',  cls: 'bg-cyan-500/15 text-cyan-400' },
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

interface TreeNode {
  id: string;
  title: string;
  status: string;
  type: string;
  progress?: number;
  children: TreeNode[];
}

function TreeRow({
  node,
  depth,
  defaultExpanded,
  onStatusChange,
}: {
  node: TreeNode;
  depth: number;
  defaultExpanded: boolean;
  onStatusChange: (nodeType: string, id: string, status: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState(node.status);
  const [saving, setSaving] = useState(false);

  const hasChildren = node.children.length > 0;
  const typeInfo = TYPE_CONFIG[node.type] ?? { label: node.type.toUpperCase(), cls: 'bg-slate-500/15 text-slate-400' };

  const handleStatusChange = async (newStatus: string) => {
    if (newStatus === status) { setEditing(false); return; }
    setSaving(true);
    try {
      await onStatusChange(node.type, node.id, newStatus);
      setStatus(newStatus);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  return (
    <>
      <div
        className={`group flex items-center gap-2 border-b border-slate-800/40 text-sm transition-colors hover:bg-slate-800/30 ${
          depth > 0 ? 'bg-slate-900/20' : ''
        }`}
        style={{ paddingTop: '8px', paddingBottom: '8px', paddingRight: '16px', paddingLeft: `${16 + depth * 20}px` }}
      >
        {/* expand toggle */}
        <button
          className="w-5 h-5 flex items-center justify-center shrink-0 text-slate-500 hover:text-slate-300"
          onClick={() => hasChildren && setExpanded(e => !e)}
        >
          {hasChildren
            ? expanded
              ? <ChevronDown className="w-3.5 h-3.5" />
              : <ChevronRight className="w-3.5 h-3.5" />
            : <span className="w-3.5 h-3.5" />}
        </button>

        {/* type badge */}
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ${typeInfo.cls}`}>
          {typeInfo.label}
        </span>

        {/* title */}
        <span className={`flex-1 truncate ${depth === 0 ? 'text-gray-100 font-medium' : 'text-gray-300'}`}>
          {node.title}
        </span>

        {/* progress (kr only) */}
        {node.type === 'kr' && node.progress !== undefined && (
          <span className="text-[11px] text-slate-500 tabular-nums w-10 text-right shrink-0">
            {node.progress}%
          </span>
        )}

        {/* status badge / inline edit */}
        <div className="shrink-0 relative">
          {editing ? (
            <select
              autoFocus
              className="text-xs bg-slate-700 border border-slate-600 rounded px-1.5 py-0.5 text-gray-300 focus:outline-none"
              defaultValue={status}
              onBlur={() => setEditing(false)}
              onChange={(e) => handleStatusChange(e.target.value)}
            >
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          ) : (
            <button
              className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-full cursor-pointer hover:opacity-80 ${
                STATUS_STYLES[status] ?? STATUS_STYLES.pending
              } ${saving ? 'opacity-50' : ''}`}
              onClick={() => setEditing(true)}
              title="点击修改状态"
            >
              {saving ? '...' : (STATUS_LABELS[status] ?? status)}
            </button>
          )}
        </div>

        {/* children count */}
        {hasChildren && (
          <span className="text-[10px] text-slate-600 shrink-0 w-6 text-right">
            {node.children.length}
          </span>
        )}
      </div>

      {expanded && hasChildren && node.children.map(child => (
        <TreeRow
          key={child.id}
          node={child}
          depth={depth + 1}
          defaultExpanded={depth < 1}
          onStatusChange={onStatusChange}
        />
      ))}
    </>
  );
}

export default function GTDOkr() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tasks/full-tree');
      setTree(res.ok ? await res.json() : []);
    } catch {
      setTree([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleStatusChange = useCallback(async (nodeType: string, id: string, status: string) => {
    await fetch(`/api/tasks/full-tree/${nodeType}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-900">
      {/* 工具栏 */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-slate-800">
        <Target className="w-4 h-4 text-slate-400" />
        <span className="text-sm font-medium text-gray-200">OKR 全树</span>
        {!loading && (
          <span className="text-xs text-slate-500">{tree.length} 个 Area</span>
        )}
      </div>

      {/* 数据行 */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            加载中...
          </div>
        ) : tree.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
            暂无 OKR 数据
          </div>
        ) : (
          tree.map(node => (
            <TreeRow
              key={node.id}
              node={node}
              depth={0}
              defaultExpanded={true}
              onStatusChange={handleStatusChange}
            />
          ))
        )}
      </div>

      {/* 底部统计 */}
      {!loading && tree.length > 0 && (
        <div className="shrink-0 px-4 py-2 text-xs text-slate-600 border-t border-slate-800 flex items-center gap-4">
          <span>{tree.length} 个 Area</span>
          <span>点击状态可编辑</span>
        </div>
      )}
    </div>
  );
}
