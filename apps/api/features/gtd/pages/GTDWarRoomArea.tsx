/**
 * WarRoom Area 详情页 — /gtd/warroom/:areaId
 * 三列独立滚动：当前目标 | 进行中任务 | KR 进度
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, Target, Zap, CheckCircle2, Clock, Circle, AlertCircle, ArrowLeft } from 'lucide-react';

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
  const [tree, setTree] = useState<OkrNode[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [treeRes, tasksRes] = await Promise.allSettled([
      fetch('/api/tasks/full-tree?view=okr'),
      fetch('/api/brain/tasks?status=in_progress&limit=50'),
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

  // 找到目标 Area
  let currentArea: OkrNode | null = null;
  for (const vision of tree) {
    for (const area of vision.children) {
      if (area.id === areaId) {
        currentArea = area;
        break;
      }
    }
    if (currentArea) break;
  }

  if (!currentArea) {
    return (
      <div className="flex items-center justify-center h-full text-slate-600">
        <div className="text-center">
          <Circle className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Area 不存在</p>
        </div>
      </div>
    );
  }

  const objectives = currentArea.children.filter(
    obj => obj.status === 'active' || obj.status === 'in_progress'
  );

  const allKrs = objectives.flatMap(obj => obj.children.filter(kr => kr.status !== 'completed'));

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 顶部页头 */}
      <div className="shrink-0 px-4 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <button
            className="text-slate-500 hover:text-slate-300 transition-colors"
            onClick={() => navigate('/gtd/warroom')}
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <Target className="w-5 h-5 text-amber-400" />
          <h1 className="text-lg font-semibold text-gray-100">{nodeTitle(currentArea)}</h1>
          <span className="text-xs text-slate-500">Area 详情</span>
          <button
            className="ml-auto text-xs text-slate-500 hover:text-slate-300"
            onClick={fetchData}
          >
            刷新
          </button>
        </div>
      </div>

      {/* 三列布局 */}
      {objectives.length === 0 && tasks.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-slate-600">
          <div className="text-center">
            <Circle className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">暂无活跃数据</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-3 gap-3 px-4 pb-4 overflow-hidden">
          {/* 左列：Objectives */}
          <div className="overflow-y-auto space-y-2 pr-1">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider sticky top-0 bg-[#0f1117] py-1.5">
              当前目标
            </h2>
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
                      {obj.description && (
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed line-clamp-2">{obj.description}</p>
                      )}
                      <div className="mt-1.5 text-xs text-slate-500">
                        {obj.children.length} 个 KR
                        {obj.children.filter(kr => kr.status !== 'completed').length > 0 && (
                          <span className="ml-1 text-amber-400">
                            ({obj.children.filter(kr => kr.status !== 'completed').length} 待完成)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 中列：进行中 Tasks */}
          <div className="overflow-y-auto space-y-1.5 pr-1">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider sticky top-0 bg-[#0f1117] py-1.5">
              进行中任务
            </h2>
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
                </div>
              ))
            )}
          </div>

          {/* 右列：KR 进度 */}
          <div className="overflow-y-auto pr-1">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider sticky top-0 bg-[#0f1117] py-1.5">
              KR 进度
            </h2>
            {allKrs.length === 0 ? (
              <p className="text-xs text-slate-600 py-4 text-center">暂无待完成 KR</p>
            ) : (
              <div className="space-y-2 mt-1">
                {allKrs.map(kr => (
                  <div key={kr.id} className="bg-slate-800/30 border border-slate-700/30 rounded-lg p-2.5">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="text-[10px] px-1 py-0.5 rounded font-mono bg-blue-500/15 text-blue-400 shrink-0">KR</span>
                      <span className="text-xs text-slate-300 flex-1 truncate">{nodeTitle(kr)}</span>
                    </div>
                    {kr.progress !== undefined && (
                      <>
                        <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                          {kr.target_value !== undefined && kr.target_value !== null ? (
                            <span>{kr.current_value ?? 0}/{kr.target_value}{kr.unit ? ` ${kr.unit}` : ''}</span>
                          ) : (
                            <span />
                          )}
                          <span className="text-blue-400 tabular-nums">{kr.progress}%</span>
                        </div>
                        <div className="h-1 bg-slate-700/50 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500/60 rounded-full"
                            style={{ width: `${kr.progress}%` }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
