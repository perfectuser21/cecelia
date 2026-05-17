/**
 * OKR 全树视图页面
 * 路由: /okr/tree
 * 数据源: GET /api/brain/okr/tree
 *
 * 展示 Vision → Objectives → KRs → Projects → Scopes → Initiatives → Tasks
 * 每层节点可展开/收起，点击跳转详情
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronRight,
  ChevronDown,
  Target,
  Key,
  FolderKanban,
  Layers,
  Zap,
  CheckSquare,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';

// ─── 类型定义 ──────────────────────────────────────────────────────────────────

interface OKRTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  okr_initiative_id: string;
}

interface OKRInitiative {
  id: string;
  title: string;
  status: string;
  tasks: OKRTask[];
}

interface OKRScope {
  id: string;
  title: string;
  status: string;
  initiatives: OKRInitiative[];
}

interface OKRProject {
  id: string;
  title: string;
  status: string;
  scopes: OKRScope[];
}

interface OKRKeyResult {
  id: string;
  title: string;
  status: string;
  current_value: number;
  target_value: number;
  unit: string;
  projects: OKRProject[];
}

interface OKRObjective {
  id: string;
  title: string;
  status: string;
  description?: string;
  key_results: OKRKeyResult[];
}

interface OKRVision {
  id: string;
  title: string;
  status: string;
  objectives: OKRObjective[];
}

// ─── 状态颜色 ─────────────────────────────────────────────────────────────────

function statusColor(status: string): string {
  switch (status) {
    case 'active': return 'text-green-500 bg-green-500/10';
    case 'completed': return 'text-blue-500 bg-blue-500/10';
    case 'paused': return 'text-yellow-500 bg-yellow-500/10';
    case 'cancelled': return 'text-red-500 bg-red-500/10';
    default: return 'text-gray-400 bg-gray-400/10';
  }
}

function priorityColor(priority: string): string {
  switch (priority?.toLowerCase()) {
    case 'p0': return 'text-red-400 bg-red-400/10';
    case 'p1': return 'text-orange-400 bg-orange-400/10';
    case 'p2': return 'text-yellow-400 bg-yellow-400/10';
    default: return 'text-gray-400 bg-gray-400/10';
  }
}

// ─── 行组件 ───────────────────────────────────────────────────────────────────

interface NodeRowProps {
  icon: React.ReactNode;
  label: string;
  status?: string;
  badge?: string;
  badgeColor?: string;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  onToggle: () => void;
  href?: string;
  count?: number;
}

function NodeRow({
  icon, label, status, badge, badgeColor, depth, expanded, hasChildren, onToggle, href, count
}: NodeRowProps) {
  const indentPx = depth * 20;

  return (
    <div
      className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-slate-800/50 cursor-pointer group"
      style={{ paddingLeft: `${8 + indentPx}px` }}
      onClick={onToggle}
    >
      {/* 展开/收起箭头 */}
      <span className="w-4 shrink-0 text-slate-500">
        {hasChildren
          ? (expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />)
          : <span className="w-3.5 h-3.5 block" />
        }
      </span>

      {/* 节点图标 */}
      <span className="shrink-0">{icon}</span>

      {/* 标题 */}
      {href ? (
        <Link
          to={href}
          className="flex-1 text-sm text-slate-200 hover:text-white truncate"
          onClick={e => e.stopPropagation()}
        >
          {label}
        </Link>
      ) : (
        <span className="flex-1 text-sm text-slate-200 truncate">{label}</span>
      )}

      {/* 右侧信息 */}
      <div className="flex items-center gap-1.5 shrink-0">
        {badge && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${badgeColor || 'text-slate-400 bg-slate-700'}`}>
            {badge}
          </span>
        )}
        {status && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColor(status)}`}>
            {status}
          </span>
        )}
        {count !== undefined && count > 0 && (
          <span className="text-[10px] text-slate-500">{count}</span>
        )}
      </div>
    </div>
  );
}

// ─── Task 行（叶节点，不需展开） ──────────────────────────────────────────────

function TaskRow({ task, depth }: { task: OKRTask; depth: number }) {
  const indentPx = depth * 20;
  return (
    <div
      className="flex items-center gap-2 py-1 px-2 rounded-lg hover:bg-slate-800/30"
      style={{ paddingLeft: `${8 + indentPx}px` }}
    >
      <span className="w-4 shrink-0" />
      <CheckSquare className="w-3.5 h-3.5 text-slate-500 shrink-0" />
      <Link
        to={`/tasks/${task.id}`}
        className="flex-1 text-xs text-slate-400 hover:text-slate-200 truncate"
      >
        {task.title}
      </Link>
      <div className="flex items-center gap-1 shrink-0">
        {task.priority && (
          <span className={`text-[10px] px-1 py-0.5 rounded font-mono ${priorityColor(task.priority)}`}>
            {task.priority}
          </span>
        )}
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColor(task.status)}`}>
          {task.status}
        </span>
      </div>
    </div>
  );
}

// ─── Initiative 树节点 ────────────────────────────────────────────────────────

function InitiativeNode({ initiative, depth }: { initiative: OKRInitiative; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasTasks = initiative.tasks.length > 0;
  return (
    <div>
      <NodeRow
        icon={<Zap className="w-3.5 h-3.5 text-yellow-400" />}
        label={initiative.title}
        status={initiative.status}
        depth={depth}
        expanded={expanded}
        hasChildren={hasTasks}
        onToggle={() => setExpanded(p => !p)}
        href={`/initiatives/${initiative.id}`}
        count={hasTasks ? initiative.tasks.length : undefined}
      />
      {expanded && hasTasks && (
        <div>
          {initiative.tasks.map(task => (
            <TaskRow key={task.id} task={task} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Scope 树节点 ─────────────────────────────────────────────────────────────

function ScopeNode({ scope, depth }: { scope: OKRScope; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = scope.initiatives.length > 0;
  return (
    <div>
      <NodeRow
        icon={<Layers className="w-3.5 h-3.5 text-purple-400" />}
        label={scope.title}
        status={scope.status}
        depth={depth}
        expanded={expanded}
        hasChildren={hasChildren}
        onToggle={() => setExpanded(p => !p)}
        count={hasChildren ? scope.initiatives.length : undefined}
      />
      {expanded && hasChildren && (
        <div>
          {scope.initiatives.map(initiative => (
            <InitiativeNode key={initiative.id} initiative={initiative} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Project 树节点 ───────────────────────────────────────────────────────────

function ProjectNode({ project, depth }: { project: OKRProject; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = project.scopes.length > 0;
  return (
    <div>
      <NodeRow
        icon={<FolderKanban className="w-3.5 h-3.5 text-blue-400" />}
        label={project.title}
        status={project.status}
        depth={depth}
        expanded={expanded}
        hasChildren={hasChildren}
        onToggle={() => setExpanded(p => !p)}
        href={`/projects/${project.id}`}
        count={hasChildren ? project.scopes.length : undefined}
      />
      {expanded && hasChildren && (
        <div>
          {project.scopes.map(scope => (
            <ScopeNode key={scope.id} scope={scope} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── KeyResult 树节点 ─────────────────────────────────────────────────────────

function KeyResultNode({ kr, depth }: { kr: OKRKeyResult; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = kr.projects.length > 0;

  const progress = kr.target_value > 0
    ? Math.round((kr.current_value / kr.target_value) * 100)
    : 0;

  return (
    <div>
      <NodeRow
        icon={<Key className="w-3.5 h-3.5 text-emerald-400" />}
        label={kr.title}
        status={kr.status}
        badge={`${progress}%`}
        badgeColor="text-emerald-400 bg-emerald-400/10 font-mono"
        depth={depth}
        expanded={expanded}
        hasChildren={hasChildren}
        onToggle={() => setExpanded(p => !p)}
        count={hasChildren ? kr.projects.length : undefined}
      />
      {expanded && hasChildren && (
        <div>
          {kr.projects.map(project => (
            <ProjectNode key={project.id} project={project} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Objective 树节点 ─────────────────────────────────────────────────────────

function ObjectiveNode({ objective, depth }: { objective: OKRObjective; depth: number }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = objective.key_results.length > 0;
  return (
    <div>
      <NodeRow
        icon={<Target className="w-4 h-4 text-violet-400" />}
        label={objective.title}
        status={objective.status}
        badge={`${objective.key_results.length} KR`}
        badgeColor="text-violet-400 bg-violet-400/10"
        depth={depth}
        expanded={expanded}
        hasChildren={hasChildren}
        onToggle={() => setExpanded(p => !p)}
      />
      {expanded && hasChildren && (
        <div>
          {objective.key_results.map(kr => (
            <KeyResultNode key={kr.id} kr={kr} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Vision 树节点 ────────────────────────────────────────────────────────────

function VisionNode({ vision }: { vision: OKRVision }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = vision.objectives.length > 0;
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 px-2 py-2 mb-1 rounded-lg bg-slate-800/60 border border-slate-700/50">
        <span
          className="cursor-pointer text-slate-400 hover:text-white"
          onClick={() => setExpanded(p => !p)}
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
        <span className="text-sm font-semibold text-white flex-1 truncate">{vision.title}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColor(vision.status)}`}>
          {vision.status}
        </span>
        <span className="text-xs text-slate-500">{vision.objectives.length} 目标</span>
      </div>
      {expanded && hasChildren && (
        <div className="ml-2">
          {vision.objectives.map(obj => (
            <ObjectiveNode key={obj.id} objective={obj} depth={0} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────

export default function OKRTreePage() {
  const [tree, setTree] = useState<OKRVision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTree = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/brain/okr/tree');
      if (!res.ok) throw new Error(`请求失败: ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '未知错误');
      setTree(data.tree || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTree(); }, [fetchTree]);

  return (
    <div className="h-full flex flex-col bg-slate-900 text-white">
      {/* 头部 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <Target className="w-5 h-5 text-violet-400" />
          <h1 className="text-lg font-semibold">OKR 全树视图</h1>
          {!loading && (
            <span className="text-sm text-slate-500">
              {tree.length} 个 Vision
            </span>
          )}
        </div>
        <button
          onClick={fetchTree}
          disabled={loading}
          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-auto px-4 py-4">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-red-400 bg-red-400/10 rounded-lg px-4 py-3 mx-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {!loading && !error && tree.length === 0 && (
          <div className="text-center py-20 text-slate-500">
            <Target className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>暂无 OKR 数据</p>
          </div>
        )}

        {!loading && !error && tree.length > 0 && (
          <div className="max-w-4xl">
            {/* 图例 */}
            <div className="flex items-center gap-4 mb-4 px-2 text-xs text-slate-500 flex-wrap">
              <span className="flex items-center gap-1"><Target className="w-3 h-3 text-violet-400" /> Objective</span>
              <span className="flex items-center gap-1"><Key className="w-3 h-3 text-emerald-400" /> Key Result</span>
              <span className="flex items-center gap-1"><FolderKanban className="w-3 h-3 text-blue-400" /> Project</span>
              <span className="flex items-center gap-1"><Layers className="w-3 h-3 text-purple-400" /> Scope</span>
              <span className="flex items-center gap-1"><Zap className="w-3 h-3 text-yellow-400" /> Initiative</span>
              <span className="flex items-center gap-1"><CheckSquare className="w-3 h-3 text-slate-500" /> Task</span>
            </div>

            {tree.map(vision => (
              <VisionNode key={vision.id} vision={vision} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
