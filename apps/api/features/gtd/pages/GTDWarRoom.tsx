/**
 * WarRoom — 作战室总览页
 * 显示活跃 Vision + Area 卡片（Cecelia / ZenithJoy），点击进入 Area 详情
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Target, ChevronRight, Circle } from 'lucide-react';

interface OkrNode {
  id: string;
  title?: string;
  name?: string;
  status: string;
  type: string;
  description?: string | null;
  progress?: number;
  children: OkrNode[];
}

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
}

function nodeTitle(n: OkrNode) {
  return n.title || n.name || '(无标题)';
}

function countActiveObjectives(area: OkrNode): number {
  return area.children.filter(
    obj => obj.status === 'active' || obj.status === 'in_progress'
  ).length;
}

function calcKrProgress(area: OkrNode): number {
  const activeObjs = area.children.filter(
    obj => obj.status === 'active' || obj.status === 'in_progress'
  );
  const totalKRs = activeObjs.reduce((sum, obj) => sum + obj.children.length, 0);
  const doneKRs = activeObjs.reduce(
    (sum, obj) => sum + obj.children.filter(kr => kr.status === 'completed').length,
    0
  );
  const pct = totalKRs > 0 ? Math.round((doneKRs / totalKRs) * 100) : 0;
  return pct;
}

const AREA_ACCENT: Record<string, { border: string; tag: string; text: string; badge: string }> = {
  Cecelia: {
    border: 'border-blue-500/30 hover:border-blue-500/60',
    tag: 'bg-blue-500/15 text-blue-400',
    text: 'text-blue-300',
    badge: 'bg-blue-500/10',
  },
  ZenithJoy: {
    border: 'border-purple-500/30 hover:border-purple-500/60',
    tag: 'bg-purple-500/15 text-purple-400',
    text: 'text-purple-300',
    badge: 'bg-purple-500/10',
  },
};

const DEFAULT_ACCENT = {
  border: 'border-slate-600/40 hover:border-slate-500/60',
  tag: 'bg-slate-500/15 text-slate-400',
  text: 'text-slate-300',
  badge: 'bg-slate-500/10',
};

export default function GTDWarRoom() {
  const [tree, setTree] = useState<OkrNode[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [treeRes, tasksRes] = await Promise.allSettled([
      fetch('/api/tasks/full-tree?view=okr'),
      fetch('/api/brain/tasks?status=in_progress&limit=50'),
    ]);
    setTree(
      treeRes.status === 'fulfilled' && treeRes.value.ok
        ? await treeRes.value.json()
        : []
    );
    setTasks(
      tasksRes.status === 'fulfilled' && tasksRes.value.ok
        ? await tasksRes.value.json()
        : []
    );
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

  // 只取活跃 Vision
  const activeVisions = tree.filter(n => n.type === 'vision' && n.status === 'active');
  // 从活跃 Vision 下收集所有 Area
  const areas: OkrNode[] = [];
  activeVisions.forEach(v => {
    v.children.forEach(child => {
      if (child.type === 'area') areas.push(child);
    });
  });

  const mainVision = activeVisions[0];
  const inProgressCount = tasks.length;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 页头 */}
      <div className="shrink-0 px-5 pt-4 pb-3 flex items-center gap-3">
        <Target className="w-4 h-4 text-amber-400" />
        <h1 className="text-base font-semibold text-gray-100">作战室</h1>
        <button
          className="ml-auto text-xs text-slate-500 hover:text-slate-300 transition-colors"
          onClick={fetchData}
        >
          刷新
        </button>
      </div>

      {/* Vision 横幅 — 单行紧凑 */}
      {mainVision && (
        <div className="shrink-0 mx-5 mb-4 bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-2.5 flex items-center gap-3">
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
            VISION
          </span>
          <p className="text-sm text-amber-100 font-medium truncate flex-1">
            {nodeTitle(mainVision)}
          </p>
          {activeVisions.length > 1 && (
            <span className="text-[10px] text-amber-600/60 shrink-0">+{activeVisions.length - 1}</span>
          )}
        </div>
      )}

      {/* Area 卡片网格 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-5">
        {areas.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-600">
            <Circle className="w-8 h-8 mb-3 opacity-30" />
            <p className="text-sm">暂无活跃 Area</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {areas.map(area => {
              const name = nodeTitle(area);
              const accent = AREA_ACCENT[name] ?? DEFAULT_ACCENT;
              const activeObjCount = countActiveObjectives(area);
              const pct = calcKrProgress(area);

              return (
                <button
                  key={area.id}
                  onClick={() => navigate(`/gtd/warroom/${area.id}`)}
                  className={`text-left bg-slate-800/30 border ${accent.border} rounded-xl p-4 transition-all duration-150 hover:bg-slate-800/50 group`}
                >
                  {/* Area 名称 */}
                  <div className="flex items-center justify-between mb-3">
                    <span className={`text-[11px] font-mono px-2 py-0.5 rounded ${accent.tag}`}>
                      {name.toUpperCase()}
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 transition-colors" />
                  </div>

                  {/* 三项指标 */}
                  <div className="space-y-2">
                    <div className={`rounded-lg px-3 py-2 ${accent.badge}`}>
                      <p className="text-[10px] text-slate-500 mb-0.5">活跃目标</p>
                      <p className={`text-2xl font-bold tabular-nums ${accent.text}`}>
                        {activeObjCount}
                      </p>
                    </div>
                    <div className="rounded-lg px-3 py-2 bg-slate-700/20">
                      <p className="text-[10px] text-slate-500 mb-0.5">进行中任务</p>
                      <p className="text-2xl font-bold tabular-nums text-slate-300">
                        {inProgressCount}
                      </p>
                    </div>
                    <div className="rounded-lg px-3 py-2 bg-slate-700/20">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[10px] text-slate-500">KR 整体进度</p>
                        <p className="text-[11px] tabular-nums text-slate-400">{pct}%</p>
                      </div>
                      <div className="h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500/60 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* 最近 OBJ 预览 */}
                  {activeObjCount > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-700/30 space-y-1">
                      {area.children
                        .filter(obj => obj.status === 'active' || obj.status === 'in_progress')
                        .slice(0, 2)
                        .map(obj => (
                          <p key={obj.id} className="text-xs text-slate-500 truncate">
                            · {nodeTitle(obj)}
                          </p>
                        ))}
                      {activeObjCount > 2 && (
                        <p className="text-xs text-slate-600">+{activeObjCount - 2} 个目标</p>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
