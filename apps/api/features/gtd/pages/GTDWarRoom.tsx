/**
 * WarRoom — 作战室：当前系统状态一览
 * 横向多列布局：Vision 顶部横幅 + 左（Objectives+KR）/ 中（Tasks）/ 右（备用）
 */

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Target, Zap, CheckCircle2, Clock, Circle, AlertCircle } from 'lucide-react';

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
  created_at?: string;
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

export default function GTDWarRoom() {
  const [tree, setTree] = useState<OkrNode[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [treeRes, tasksRes] = await Promise.allSettled([
      fetch('/api/tasks/full-tree?view=okr'),
      fetch('/api/brain/tasks?status=in_progress&limit=8'),
    ]);
    setTree(treeRes.status === 'fulfilled' && treeRes.value.ok ? await treeRes.value.json() : []);
    setTasks(tasksRes.status === 'fulfilled' && tasksRes.value.ok ? await tasksRes.value.json() : []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        加载中...
      </div>
    );
  }

  // 找 Vision（第一层）
  const visions = tree.filter(n => n.type === 'vision');
  // 所有活跃 Objective（展平）
  const objectives: OkrNode[] = [];
  tree.forEach(v => {
    v.children.forEach(area => {
      area.children.forEach(obj => {
        if (obj.status === 'active' || obj.status === 'in_progress') {
          objectives.push(obj);
        }
      });
    });
  });

  const isEmpty = visions.length === 0 && objectives.length === 0 && tasks.length === 0;

  return (
    <div className="h-full flex flex-col px-4 pt-4 pb-2 gap-3 min-h-0">
      {/* 页头 */}
      <div className="flex items-center gap-3 shrink-0">
        <Target className="w-5 h-5 text-amber-400" />
        <h1 className="text-lg font-semibold text-gray-100">作战室</h1>
        <span className="text-xs text-slate-500">当前我们在往哪跑</span>
        <button
          className="ml-auto text-xs text-slate-500 hover:text-slate-300"
          onClick={fetchData}
        >
          刷新
        </button>
      </div>

      {/* Vision 顶部横幅（全宽） */}
      {visions.length > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 shrink-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30">
              VISION
            </span>
            <span className="text-xs text-amber-600/60">北极星</span>
          </div>
          {visions.map(v => (
            <div key={v.id}>
              <p className="text-base font-semibold text-amber-100">{nodeTitle(v)}</p>
              {v.description && (
                <p className="text-xs text-amber-700/70 mt-1 leading-relaxed">{v.description}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {isEmpty ? (
        <div className="flex-1 flex items-center justify-center text-slate-600">
          <div className="text-center">
            <Circle className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">暂无活跃数据</p>
          </div>
        </div>
      ) : (
        /* 三列主内容区 */
        <div className="flex-1 flex gap-3 min-h-0 overflow-hidden">
          {/* 左列：Objectives + KR */}
          <div className="flex-1 flex flex-col min-h-0">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 shrink-0">
              当前目标
            </h2>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {objectives.length === 0 ? (
                <p className="text-xs text-slate-600 py-4 text-center">暂无活跃目标</p>
              ) : (
                objectives.map(obj => (
                  <div key={obj.id} className="bg-slate-800/40 border border-slate-700/40 rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-purple-500/15 text-purple-400 shrink-0 mt-0.5">
                        OBJ
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-200 font-medium">{nodeTitle(obj)}</p>
                        {obj.children.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {obj.children.filter(kr => kr.status !== 'completed').map(kr => (
                              <div key={kr.id} className="flex items-center gap-2">
                                <span className="text-[10px] px-1 py-0.5 rounded font-mono bg-blue-500/15 text-blue-400 shrink-0">KR</span>
                                <span className="text-xs text-slate-400 truncate flex-1">{nodeTitle(kr)}</span>
                                {kr.progress !== undefined && (
                                  <span className="text-[11px] text-blue-400 tabular-nums shrink-0">{kr.progress}%</span>
                                )}
                                {kr.target_value !== undefined && kr.target_value !== null && (
                                  <span className="text-[11px] text-slate-500 shrink-0">
                                    {kr.current_value ?? 0}/{kr.target_value}{kr.unit ? ` ${kr.unit}` : ''}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 中列：进行中 Tasks */}
          <div className="flex-1 flex flex-col min-h-0">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 shrink-0">
              进行中任务
            </h2>
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {tasks.length === 0 ? (
                <p className="text-xs text-slate-600 py-4 text-center">暂无进行中任务</p>
              ) : (
                tasks.map(t => (
                  <div key={t.id} className="flex items-center gap-2 py-1.5 px-3 bg-slate-800/30 rounded-lg border border-slate-700/30">
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
                    {t.task_type && (
                      <span className="text-[10px] text-slate-600 shrink-0">{t.task_type}</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 右列：备用 */}
          <div className="flex-1 flex flex-col min-h-0">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 shrink-0">
              &nbsp;
            </h2>
            <div className="flex-1 overflow-y-auto" />
          </div>
        </div>
      )}
    </div>
  );
}
