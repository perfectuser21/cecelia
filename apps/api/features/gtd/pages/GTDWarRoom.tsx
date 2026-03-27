/**
 * GTDWarRoom — 作战室总览页
 * Vision 横幅 + Area 卡片列表，点击进入 Area 详情页
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Target, RefreshCw, ChevronRight } from 'lucide-react';

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

export function toAreaSlug(name: string): string {
  return name
    .replace(/([A-Z])/g, (_, c, i: number) => (i > 0 ? '-' : '') + c.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

interface AreaSummary {
  id: string;
  title: string;
  slug: string;
  activeObjCount: number;
  totalKrCount: number;
  completedKrCount: number;
}

export function buildAreaSummaries(tree: OkrNode[]): { vision: OkrNode | null; areas: AreaSummary[] } {
  const activeVision =
    tree.find(n => n.type === 'vision' && n.status === 'active' && n.children.length > 0) || null;

  if (!activeVision) return { vision: null, areas: [] };

  const areas: AreaSummary[] = activeVision.children
    .filter(a => a.type === 'area')
    .map(area => {
      const activeObjs = area.children.filter(
        o => o.type === 'objective' && (o.status === 'active' || o.status === 'in_progress'),
      );
      const allKrs = activeObjs.flatMap(o => o.children.filter(kr => kr.type === 'kr'));
      const completedKrs = allKrs.filter(kr => kr.status === 'completed');
      return {
        id: area.id,
        title: nodeTitle(area),
        slug: toAreaSlug(nodeTitle(area)),
        activeObjCount: activeObjs.length,
        totalKrCount: allKrs.length,
        completedKrCount: completedKrs.length,
      };
    })
    .filter(a => a.activeObjCount > 0);

  return { vision: activeVision, areas };
}

export default function GTDWarRoom() {
  const [tree, setTree] = useState<OkrNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tasks/full-tree?view=okr');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTree(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const { vision, areas } = buildAreaSummaries(tree);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-900">
      {/* 页头 */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-slate-800">
        <Target className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-medium text-gray-200">作战室</span>
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
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {/* Vision 横幅 */}
          {vision && (
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  VISION
                </span>
                <span className="text-xs text-amber-600/60">北极星</span>
              </div>
              <p className="text-sm font-semibold text-amber-100">{nodeTitle(vision)}</p>
              {vision.description && (
                <p className="text-xs text-amber-700/70 mt-0.5 leading-relaxed">{vision.description}</p>
              )}
            </div>
          )}

          {/* 错误提示 */}
          {error && (
            <div className="text-xs text-red-400 px-3 py-2 bg-red-500/10 rounded-lg border border-red-500/20">
              {error}
            </div>
          )}

          {/* Area 卡片列表 */}
          {areas.length === 0 && !error ? (
            <div className="text-center py-12 text-slate-600">
              <Target className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p className="text-sm">暂无活跃 Area</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {areas.map(area => {
                const krProgress =
                  area.totalKrCount > 0
                    ? Math.round((area.completedKrCount / area.totalKrCount) * 100)
                    : 0;

                return (
                  <Link
                    key={area.id}
                    to={`/gtd/warroom/${area.slug}`}
                    className="group block bg-slate-800/30 border border-slate-700/40 hover:border-slate-600/60 hover:bg-slate-800/50 rounded-xl p-4 transition-all"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-violet-500/15 text-violet-400">
                          AREA
                        </span>
                        <span className="text-sm font-medium text-gray-200">{area.title}</span>
                      </div>
                      <ChevronRight
                        size={14}
                        className="text-slate-600 group-hover:text-slate-400 transition-colors"
                      />
                    </div>

                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <span>
                        <span className="text-purple-400 font-medium">{area.activeObjCount}</span>
                        {' '}活跃目标
                      </span>
                      <span>
                        <span className="text-blue-400 font-medium">{area.totalKrCount}</span>
                        {' '}KR
                      </span>
                    </div>

                    {area.totalKrCount > 0 && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                          <span>KR 进度</span>
                          <span className="text-blue-400">{krProgress}%</span>
                        </div>
                        <div className="h-1 bg-slate-700/50 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500/50 rounded-full transition-all"
                            style={{ width: `${krProgress}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
