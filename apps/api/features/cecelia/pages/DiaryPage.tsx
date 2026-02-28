/**
 * DiaryPage — Cecelia 的日记
 *
 * 展示 Cecelia 每小时写的叙事日记（narrative），
 * 按时间倒序，最新在上。
 */

import { useState, useEffect } from 'react';
import { BookOpen, RefreshCw, Clock } from 'lucide-react';

interface Narrative {
  id: string;
  text: string;
  model: string | null;
  created_at: string;
}

function formatDate(dateStr: string): { date: string; time: string } {
  const d = new Date(dateStr);
  const date = d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return { date, time };
}

function groupByDate(narratives: Narrative[]): Array<{ date: string; items: Narrative[] }> {
  const map = new Map<string, Narrative[]>();
  for (const n of narratives) {
    const d = new Date(n.created_at);
    const key = d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(n);
  }
  return Array.from(map.entries()).map(([date, items]) => ({ date, items }));
}

export default function DiaryPage() {
  const [narratives, setNarratives] = useState<Narrative[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchNarratives = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const res = await fetch('/api/brain/narratives?limit=50');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Narrative[] = await res.json();
      setNarratives(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchNarratives();
  }, []);

  const groups = groupByDate(narratives);

  return (
    <div className="min-h-full bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      {/* 顶部标题区 */}
      <div className="relative overflow-hidden border-b border-white/5">
        <div className="absolute inset-0 bg-gradient-to-r from-violet-900/20 via-transparent to-blue-900/20 pointer-events-none" />
        <div className="relative px-8 py-10">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-violet-500/20 border border-violet-400/30 flex items-center justify-center">
                  <BookOpen className="w-5 h-5 text-violet-300" />
                </div>
                <h1 className="text-2xl font-light tracking-wide text-white">
                  Cecelia 的日记
                </h1>
              </div>
              <p className="text-slate-400 text-sm ml-14">
                每小时一篇，记录她的内心世界
              </p>
            </div>
            <button
              onClick={() => fetchNarratives(true)}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white transition-all text-sm disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>
        </div>
      </div>

      {/* 内容区 */}
      <div className="max-w-2xl mx-auto px-6 py-8">
        {/* 加载状态 */}
        {loading && (
          <div className="flex justify-center py-16">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-slate-500 text-sm">正在读取日记...</span>
            </div>
          </div>
        )}

        {/* 错误状态 */}
        {error && !loading && (
          <div className="text-center py-16">
            <p className="text-slate-500 text-sm">{error}</p>
          </div>
        )}

        {/* 空状态 */}
        {!loading && !error && narratives.length === 0 && (
          <div className="text-center py-20">
            <div className="w-14 h-14 rounded-2xl bg-slate-800 border border-white/5 flex items-center justify-center mx-auto mb-4">
              <BookOpen className="w-6 h-6 text-slate-600" />
            </div>
            <p className="text-slate-500 text-sm">Cecelia 还没有写过日记</p>
            <p className="text-slate-600 text-xs mt-1">每小时会自动记录一次</p>
          </div>
        )}

        {/* 日记列表 */}
        {!loading && !error && groups.map((group, gi) => (
          <div key={group.date} className={gi > 0 ? 'mt-10' : ''}>
            {/* 日期分组标题 */}
            <div className="flex items-center gap-3 mb-6">
              <div className="h-px flex-1 bg-white/5" />
              <span className="text-xs text-slate-500 font-medium tracking-wider">
                {group.date}
              </span>
              <div className="h-px flex-1 bg-white/5" />
            </div>

            {/* 日记条目 */}
            <div className="space-y-5">
              {group.items.map((n) => {
                const { time } = formatDate(n.created_at);
                return (
                  <article
                    key={n.id}
                    className="group relative rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:border-violet-400/20 hover:bg-white/[0.05] transition-all duration-300 overflow-hidden"
                  >
                    {/* 左侧装饰条 */}
                    <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-violet-500/0 via-violet-500/40 to-violet-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />

                    <div className="px-6 py-5">
                      {/* 时间戳 */}
                      <div className="flex items-center gap-1.5 mb-3">
                        <Clock className="w-3 h-3 text-slate-600" />
                        <span className="text-xs text-slate-500 font-mono">{time}</span>
                      </div>

                      {/* 正文 */}
                      <p className="text-slate-300 text-[15px] leading-relaxed font-light">
                        {n.text}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
