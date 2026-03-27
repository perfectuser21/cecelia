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

function nodeTitle(n: OkrNode) {
  return n.title || n.name || '(无标题)';
}

function countActiveObjectives(area: OkrNode): number {
  return area.children.filter(
    obj => obj.status === 'active' || obj.status === 'in_progress'
  ).length;
}

function countPendingKRs(area: OkrNode): number {
  return area.children.reduce((sum, obj) => {
    if (obj.status !== 'active' && obj.status !== 'in_progress') return sum;
    return sum + obj.children.filter(kr => kr.status !== 'completed').length;
  }, 0);
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
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tasks/full-tree?view=okr');
      setTree(res.ok ? await res.json() : []);
    } catch {
      setTree([]);
    }
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
              const pendingKRCount = countPendingKRs(area);

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

                  {/* 统计数字 */}
                  <div className="space-y-2">
                    <div className={`rounded-lg px-3 py-2 ${accent.badge}`}>
                      <p className="text-[10px] text-slate-500 mb-0.5">活跃目标</p>
                      <p className={`text-2xl font-bold tabular-nums ${accent.text}`}>
                        {activeObjCount}
                      </p>
                    </div>
                    <div className="rounded-lg px-3 py-2 bg-slate-700/20">
                      <p className="text-[10px] text-slate-500 mb-0.5">待完成 KR</p>
                      <p className="text-2xl font-bold tabular-nums text-slate-300">
                        {pendingKRCount}
                      </p>
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
