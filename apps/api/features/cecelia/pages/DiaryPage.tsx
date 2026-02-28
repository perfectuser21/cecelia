/**
 * DiaryPage — Cecelia 的日记
 *
 * 左侧：日期列表（倒序）
 * 右侧：选中日期的日记内容
 */

import { useState, useEffect } from 'react';
import { BookOpen, RefreshCw, Calendar } from 'lucide-react';

interface Narrative {
  id: string;
  text: string;
  model: string | null;
  created_at: string;
}

interface DateGroup {
  key: string;          // YYYY-MM-DD，用于排序和唯一性
  label: string;        // "2月28日 周五"
  fullLabel: string;    // "2026年2月28日"
  items: Narrative[];
}

function buildDateGroups(narratives: Narrative[]): DateGroup[] {
  const map = new Map<string, Narrative[]>();
  for (const n of narratives) {
    const d = new Date(n.created_at);
    const key = d.toISOString().slice(0, 10); // YYYY-MM-DD
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(n);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0])) // 倒序
    .map(([key, items]) => {
      const d = new Date(key + 'T12:00:00');
      return {
        key,
        label: d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' }),
        fullLabel: d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }),
        items: items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
      };
    });
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export default function DiaryPage() {
  const [narratives, setNarratives] = useState<Narrative[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const fetchNarratives = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const res = await fetch('/api/brain/narratives?limit=90');
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

  useEffect(() => { fetchNarratives(); }, []);

  const groups = buildDateGroups(narratives);

  // 默认选最新日期
  useEffect(() => {
    if (groups.length > 0 && !selectedKey) {
      setSelectedKey(groups[0].key);
    }
  }, [groups.length]);

  const selected = groups.find(g => g.key === selectedKey) ?? groups[0] ?? null;

  return (
    <div className="h-full flex bg-slate-950 text-slate-100">

      {/* ── 左侧日期边栏 ── */}
      <aside className="w-48 shrink-0 h-full flex flex-col border-r border-white/[0.06] bg-slate-950">
        {/* 边栏标题 */}
        <div className="px-4 pt-6 pb-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-medium text-slate-300">日记</span>
          </div>
          <button
            onClick={() => fetchNarratives(true)}
            disabled={refreshing}
            className="mt-3 flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>

        {/* 日期列表 */}
        <nav className="flex-1 overflow-y-auto py-2">
          {loading && (
            <div className="flex justify-center pt-8">
              <div className="w-5 h-5 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!loading && groups.length === 0 && (
            <p className="text-center text-xs text-slate-600 pt-8">暂无日记</p>
          )}
          {!loading && groups.map(g => (
            <button
              key={g.key}
              onClick={() => setSelectedKey(g.key)}
              className={`w-full text-left px-4 py-3 transition-all duration-150 relative ${
                g.key === selectedKey
                  ? 'bg-violet-500/10 text-white'
                  : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
              }`}
            >
              {g.key === selectedKey && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-violet-400 rounded-r-full" />
              )}
              <div className="text-sm font-medium leading-tight">{g.label}</div>
              <div className="text-[11px] text-slate-600 mt-0.5">
                {g.items.length > 1 ? `${g.items.length} 篇` : '1 篇'}
              </div>
            </button>
          ))}
        </nav>
      </aside>

      {/* ── 右侧内容区 ── */}
      <main className="flex-1 h-full overflow-y-auto">
        {/* 加载/错误/空状态 */}
        {loading && (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-slate-500 text-sm">读取中...</span>
            </div>
          </div>
        )}
        {error && !loading && (
          <div className="flex items-center justify-center h-full">
            <p className="text-slate-500 text-sm">{error}</p>
          </div>
        )}
        {!loading && !error && !selected && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-14 h-14 rounded-2xl bg-slate-800 border border-white/5 flex items-center justify-center">
              <Calendar className="w-6 h-6 text-slate-600" />
            </div>
            <p className="text-slate-500 text-sm">Cecelia 还没有写过日记</p>
            <p className="text-slate-600 text-xs">每天自动记录一次</p>
          </div>
        )}

        {/* 日记内容 */}
        {!loading && !error && selected && (
          <div className="max-w-xl mx-auto px-10 py-12">
            {/* 日期标题 */}
            <div className="mb-10">
              <p className="text-xs text-violet-400 font-medium tracking-widest uppercase mb-2">Diary</p>
              <h2 className="text-2xl font-light text-white tracking-wide">{selected.fullLabel}</h2>
            </div>

            {/* 正文（每天一篇，但兼容多篇的过渡期） */}
            <div className="space-y-8">
              {selected.items.map((n, i) => (
                <div key={n.id}>
                  {selected.items.length > 1 && (
                    <div className="flex items-center gap-2 mb-4">
                      <div className="h-px flex-1 bg-white/5" />
                      <span className="text-xs text-slate-600 font-mono">{formatTime(n.created_at)}</span>
                      <div className="h-px flex-1 bg-white/5" />
                    </div>
                  )}
                  <p className="text-slate-300 text-[16px] leading-[1.9] font-light tracking-wide">
                    {n.text}
                  </p>
                  {i < selected.items.length - 1 && <div className="mt-8 h-px bg-white/5" />}
                </div>
              ))}
            </div>

            {/* 底部时间戳（单篇时显示） */}
            {selected.items.length === 1 && (
              <p className="mt-10 text-xs text-slate-600 font-mono">
                {formatTime(selected.items[0].created_at)}
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
