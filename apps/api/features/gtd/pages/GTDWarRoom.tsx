/**
 * WarRoom — 作战室总览：Vision 横幅 + Area 卡片列表
 * 点击 Area 卡片跳转到 /gtd/warroom/:areaId 详情页
 */

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Target, ChevronRight, Circle } from 'lucide-react';

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

function calcAreaProgress(area: OkrNode): number {
  const allKrs: OkrNode[] = [];
  area.children.forEach(obj => {
    obj.children.forEach(kr => allKrs.push(kr));
  });
  if (allKrs.length === 0) return 0;
  const total = allKrs.reduce((sum, kr) => sum + (kr.progress ?? 0), 0);
  return Math.round(total / allKrs.length);
}

interface AreaCardProps {
  area: OkrNode;
  inProgressCount: number;
  onClick: () => void;
}

function AreaCard({ area, inProgressCount, onClick }: AreaCardProps) {
  const activeObjs = area.children.filter(
    obj => obj.status === 'active' || obj.status === 'in_progress'
  );
  const progress = calcAreaProgress(area);
  const allKrCount = area.children.reduce((sum, obj) => sum + obj.children.length, 0);
  const pendingKrCount = area.children.reduce(
    (sum, obj) => sum + obj.children.filter(kr => kr.status !== 'completed').length,
    0
  );

  return (
    <button
      className="w-full text-left bg-slate-800/40 border border-slate-700/40 rounded-xl p-4 hover:bg-slate-800/70 hover:border-slate-600/50 transition-all group"
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-gray-100">{nodeTitle(area)}</h3>
        <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-slate-300 transition-colors" />
      </div>

      {/* 进度条 */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
          <span>KR 整体进度</span>
          <span className="text-blue-400 tabular-nums">{progress}%</span>
        </div>
        <div className="h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500/60 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* 统计数据 */}
      <div className="flex items-center gap-4 text-xs">
        <div>
          <span className="text-slate-500">活跃目标</span>
          <span className="ml-1.5 text-purple-400 tabular-nums font-medium">{activeObjs.length}</span>
        </div>
        <div>
          <span className="text-slate-500">待完成 KR</span>
          <span className="ml-1.5 text-amber-400 tabular-nums font-medium">{pendingKrCount}/{allKrCount}</span>
        </div>
        <div>
          <span className="text-slate-500">进行中任务</span>
          <span className="ml-1.5 text-emerald-400 tabular-nums font-medium">{inProgressCount}</span>
        </div>
      </div>
    </button>
  );
}

export default function GTDWarRoom() {
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

  const visions = tree.filter(n => n.type === 'vision');
  const areas: OkrNode[] = [];
  tree.forEach(v => {
    v.children.forEach(area => {
      if (area.type === 'area') areas.push(area);
    });
  });

  const isEmpty = visions.length === 0 && areas.length === 0;

  const navigateToArea = (areaId: string) => {
    window.history.pushState({}, '', `/gtd/warroom/${areaId}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 顶部页头 */}
      <div className="shrink-0 px-4 pt-4 pb-3 space-y-3">
        <div className="flex items-center gap-3">
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

        {/* Vision 横幅 */}
        {visions.length > 0 && (
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3">
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
                  <p className="text-xs text-amber-700/70 mt-0.5 leading-relaxed">{v.description}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Area 卡片列表 */}
      {isEmpty ? (
        <div className="flex-1 flex items-center justify-center text-slate-600">
          <div className="text-center">
            <Circle className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">暂无活跃数据</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {areas.map(area => (
              <AreaCard
                key={area.id}
                area={area}
                inProgressCount={tasks.length}
                onClick={() => navigateToArea(area.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
