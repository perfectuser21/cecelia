/**
 * WarRoomArea — 作战室 Area 详情页
 * 显示某个 Area 下的 OBJ → KR 列表 + 进行中任务
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Loader2, ChevronLeft, Zap, CheckCircle2, Clock, AlertCircle, Circle,
} from 'lucide-react';

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
  const { areaId } = useParams<{ areaId: string }>();
  const navigate = useNavigate();

  const [area, setArea] = useState<OkrNode | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [treeRes, tasksRes] = await Promise.allSettled([
      fetch('/api/tasks/full-tree?view=okr'),
      fetch('/api/brain/tasks?status=in_progress&limit=20'),
    ]);

    if (treeRes.status === 'fulfilled' && treeRes.value.ok) {
      const tree: OkrNode[] = await treeRes.value.json();
      // 在所有 Vision 的 children 里找这个 Area
      let found: OkrNode | null = null;
      for (const node of tree) {
        for (const child of node.children) {
          if (child.id === areaId && child.type === 'area') {
            found = child;
            break;
          }
        }
        if (found) break;
      }
      setArea(found);
    }

    setTasks(
      tasksRes.status === 'fulfilled' && tasksRes.value.ok
        ? await tasksRes.value.json()
        : []
    );
    setLoading(false);
  }, [areaId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        加载中...
      </div>
    );
  }

  if (!area) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3">
        <Circle className="w-8 h-8 opacity-30" />
        <p className="text-sm">找不到该 Area</p>
        <button
          className="text-xs text-blue-400 hover:text-blue-300"
          onClick={() => navigate('/gtd/warroom')}
        >
          ← 返回总览
        </button>
      </div>
    );
  }

  const areaName = nodeTitle(area);
  const objectives = area.children.filter(
    obj => obj.status === 'active' || obj.status === 'in_progress'
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 页头 */}
      <div className="shrink-0 px-5 pt-4 pb-3 flex items-center gap-3">
        <button
          onClick={() => navigate('/gtd/warroom')}
          className="text-slate-500 hover:text-slate-300 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-xs font-mono px-2 py-0.5 rounded bg-blue-500/15 text-blue-400">
          {areaName.toUpperCase()}
        </span>
        <h1 className="text-base font-semibold text-gray-100">{areaName}</h1>
        <button
          className="ml-auto text-xs text-slate-500 hover:text-slate-300"
          onClick={fetchData}
        >
          刷新
        </button>
      </div>

      {/* 内容：两列 */}
      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-4 px-5 pb-5 overflow-hidden">

        {/* 左列：Objectives + KR */}
        <div className="overflow-y-auto space-y-3 pr-1">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider sticky top-0 bg-[#0f1117] py-1.5">
            目标 & KR
          </h2>

          {objectives.length === 0 ? (
            <p className="text-xs text-slate-600 py-6 text-center">暂无活跃目标</p>
          ) : (
            objectives.map(obj => {
              const pendingKRs = obj.children.filter(kr => kr.status !== 'completed');
              const totalKRs = obj.children.length;
              const doneKRs = totalKRs - pendingKRs.length;
              const pct = totalKRs > 0 ? Math.round((doneKRs / totalKRs) * 100) : 0;

              return (
                <div key={obj.id} className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4">
                  {/* OBJ header */}
                  <div className="flex items-start gap-2 mb-3">
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-purple-500/15 text-purple-400 shrink-0 mt-0.5">
                      OBJ
                    </span>
                    <p className="text-sm text-gray-200 font-medium leading-snug">{nodeTitle(obj)}</p>
                  </div>

                  {/* KR 进度条 */}
                  {totalKRs > 0 && (
                    <div className="mb-3">
                      <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                        <span>KR 完成度</span>
                        <span className="tabular-nums">{doneKRs}/{totalKRs}</span>
                      </div>
                      <div className="h-1 bg-slate-700/50 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-purple-500/60 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* KR 列表 */}
                  {pendingKRs.length > 0 && (
                    <div className="space-y-1.5">
                      {pendingKRs.map(kr => (
                        <div key={kr.id} className="flex items-center gap-2">
                          <span className="text-[10px] px-1 py-0.5 rounded font-mono bg-blue-500/15 text-blue-400 shrink-0">
                            KR
                          </span>
                          <span className="text-xs text-slate-400 flex-1 truncate">{nodeTitle(kr)}</span>
                          {kr.progress !== undefined && (
                            <span className="text-[11px] text-blue-400 tabular-nums shrink-0">{kr.progress}%</span>
                          )}
                          {kr.target_value !== undefined && kr.target_value !== null && (
                            <span className="text-[11px] text-slate-500 shrink-0 tabular-nums">
                              {kr.current_value ?? 0}/{kr.target_value}{kr.unit ? ` ${kr.unit}` : ''}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* 右列：进行中任务 */}
        <div className="overflow-y-auto space-y-1.5 pr-1">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider sticky top-0 bg-[#0f1117] py-1.5">
            进行中任务
          </h2>

          {tasks.length === 0 ? (
            <p className="text-xs text-slate-600 py-6 text-center">暂无进行中任务</p>
          ) : (
            tasks.map(t => (
              <div
                key={t.id}
                className="flex items-center gap-2 py-2 px-3 bg-slate-800/30 rounded-lg border border-slate-700/30"
              >
                <TaskStatusIcon status={t.status} />
                <span className="flex-1 text-sm text-gray-300 truncate">{t.title}</span>
                {t.priority && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ${
                    t.priority === 'P0' ? 'bg-red-500/15 text-red-400' :
                    t.priority === 'P1' ? 'bg-amber-500/15 text-amber-400' :
                    'bg-slate-500/15 text-slate-400'
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
  );
}
