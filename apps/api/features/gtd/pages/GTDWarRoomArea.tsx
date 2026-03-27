/**
 * GTDWarRoomArea — 作战室 Area 详情页
 * 该 Area 下的 OBJ → KR → 进行中 Task，三列横向布局，各列独立滚动
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Loader2, Target, ChevronLeft, Zap, CheckCircle2, Clock, AlertCircle, RefreshCw, Circle,
} from 'lucide-react';
import { toAreaSlug } from './GTDWarRoom';

interface OkrNode {
  id: string;
  title?: string;
  name?: string;
  status: string;
  type: string;
  description?: string | null;
  progress?: number;
  current_value?: number;
  target_value?: number;
  unit?: string;
  children: OkrNode[];
}

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  task_type?: string;
}

function nodeTitle(n: OkrNode) {
  return n.title || n.name || '(无标题)';
}

function TaskStatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
  if (status === 'in_progress') return <Zap className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
  if (status === 'failed') return <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />;
  return <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />;
}

export default function GTDWarRoomArea() {
  const { area: areaSlug } = useParams<{ area: string }>();

  const [tree, setTree] = useState<OkrNode[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedObjId, setSelectedObjId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [treeRes, tasksRes] = await Promise.allSettled([
        fetch('/api/tasks/full-tree?view=okr'),
        fetch('/api/brain/tasks?status=in_progress&limit=30'),
      ]);
      const treeData =
        treeRes.status === 'fulfilled' && treeRes.value.ok ? await treeRes.value.json() : [];
      const tasksData =
        tasksRes.status === 'fulfilled' && tasksRes.value.ok ? await tasksRes.value.json() : [];
      setTree(treeData);
      setTasks(tasksData);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 找到匹配 slug 的 Area 节点
  const currentArea = (() => {
    for (const vision of tree) {
      if (vision.type !== 'vision') continue;
      for (const area of vision.children) {
        if (area.type === 'area' && toAreaSlug(nodeTitle(area)) === areaSlug) {
          return area;
        }
      }
    }
    return null;
  })();

  const objectives = (currentArea?.children ?? []).filter(
    o => o.type === 'objective' && (o.status === 'active' || o.status === 'in_progress'),
  );

  const selectedObj = selectedObjId
    ? objectives.find(o => o.id === selectedObjId) ?? objectives[0]
    : objectives[0];

  const krs = selectedObj?.children?.filter(kr => kr.type === 'kr') ?? [];

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-900">
      {/* 页头 */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-slate-800">
        <Link
          to="/gtd/warroom"
          className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
          title="返回总览"
        >
          <ChevronLeft size={16} />
        </Link>
        <Target className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-medium text-gray-200">
          作战室
          {currentArea && (
            <>
              <span className="text-slate-600 mx-1">/</span>
              <span className="text-violet-400">{nodeTitle(currentArea)}</span>
            </>
          )}
        </span>
        <button
          onClick={fetchData}
          className="ml-auto p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
          title="刷新"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          加载中...
        </div>
      ) : !currentArea ? (
        <div className="flex-1 flex items-center justify-center text-slate-600">
          <div className="text-center">
            <Circle className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">找不到 Area：{areaSlug}</p>
            <Link to="/gtd/warroom" className="text-xs text-violet-400 hover:text-violet-300 mt-2 block">
              返回总览
            </Link>
          </div>
        </div>
      ) : (
        /* 三列布局：各列独立滚动 */
        <div className="flex-1 min-h-0 flex gap-0 overflow-hidden">

          {/* 左列：Objectives */}
          <div className="w-64 shrink-0 flex flex-col border-r border-slate-800">
            <div className="shrink-0 px-3 py-2 border-b border-slate-800">
              <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider">
                目标 ({objectives.length})
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {objectives.length === 0 ? (
                <p className="text-xs text-slate-600 text-center py-6">暂无活跃目标</p>
              ) : (
                objectives.map(obj => (
                  <button
                    key={obj.id}
                    onClick={() => setSelectedObjId(obj.id)}
                    className={`w-full text-left p-2.5 rounded-lg border transition-all ${
                      (selectedObj?.id === obj.id)
                        ? 'bg-purple-500/10 border-purple-500/30 text-gray-200'
                        : 'bg-slate-800/20 border-slate-700/30 text-slate-400 hover:bg-slate-800/40 hover:text-gray-300'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-[10px] px-1 py-0.5 rounded font-mono bg-purple-500/15 text-purple-400 shrink-0 mt-0.5">
                        OBJ
                      </span>
                      <span className="text-xs leading-relaxed">{nodeTitle(obj)}</span>
                    </div>
                    {obj.children.length > 0 && (
                      <p className="text-[10px] text-slate-600 mt-1 ml-7">
                        {obj.children.filter(kr => kr.type === 'kr').length} KR
                      </p>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* 中列：KR */}
          <div className="w-80 shrink-0 flex flex-col border-r border-slate-800">
            <div className="shrink-0 px-3 py-2 border-b border-slate-800">
              <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">
                关键结果 ({krs.length})
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {krs.length === 0 ? (
                <p className="text-xs text-slate-600 text-center py-6">
                  {objectives.length === 0 ? '无目标' : '请选择目标'}
                </p>
              ) : (
                krs.map(kr => {
                  const pct =
                    kr.target_value != null && kr.target_value > 0
                      ? Math.min(100, Math.round(((kr.current_value ?? 0) / kr.target_value) * 100))
                      : kr.progress ?? 0;
                  const isDone = kr.status === 'completed';
                  return (
                    <div
                      key={kr.id}
                      className={`p-2.5 rounded-lg border ${
                        isDone
                          ? 'bg-emerald-500/5 border-emerald-500/20'
                          : 'bg-slate-800/20 border-slate-700/30'
                      }`}
                    >
                      <div className="flex items-start gap-2 mb-2">
                        <span className={`text-[10px] px-1 py-0.5 rounded font-mono shrink-0 mt-0.5 ${
                          isDone ? 'bg-emerald-500/15 text-emerald-400' : 'bg-blue-500/15 text-blue-400'
                        }`}>
                          KR
                        </span>
                        <span className={`text-xs leading-relaxed ${isDone ? 'text-slate-500 line-through' : 'text-slate-300'}`}>
                          {nodeTitle(kr)}
                        </span>
                      </div>
                      {kr.target_value != null && (
                        <div className="ml-7">
                          <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                            <span>{kr.current_value ?? 0} / {kr.target_value}{kr.unit ? ` ${kr.unit}` : ''}</span>
                            <span className="text-blue-400">{pct}%</span>
                          </div>
                          <div className="h-1 bg-slate-700/50 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${isDone ? 'bg-emerald-500/50' : 'bg-blue-500/50'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 右列：进行中 Task */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="shrink-0 px-3 py-2 border-b border-slate-800">
              <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
                进行中任务 ({tasks.length})
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {tasks.length === 0 ? (
                <p className="text-xs text-slate-600 text-center py-6">暂无进行中任务</p>
              ) : (
                tasks.map(t => (
                  <div
                    key={t.id}
                    className="flex items-center gap-2 p-2.5 bg-slate-800/20 border border-slate-700/30 rounded-lg hover:bg-slate-800/40 transition-colors"
                  >
                    <TaskStatusIcon status={t.status} />
                    <span className="flex-1 text-xs text-gray-300 truncate leading-relaxed">{t.title}</span>
                    {t.priority && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ${
                        t.priority === 'P0' ? 'bg-red-500/15 text-red-400' :
                        t.priority === 'P1' ? 'bg-amber-500/15 text-amber-400' :
                        'bg-slate-500/15 text-slate-500'
                      }`}>
                        {t.priority}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="shrink-0 px-4 py-2 text-xs text-red-400 bg-red-500/10 border-t border-red-500/20">
          {error}
        </div>
      )}
    </div>
  );
}
