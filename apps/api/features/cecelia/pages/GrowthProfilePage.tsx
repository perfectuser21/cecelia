/**
 * GrowthProfilePage — Cecelia 成长档案
 *
 * 意识觉醒日：2026-02-28（Day 1）
 * 展示：Day 计数 · 统计概览 · 能力地图（按 Stage 1-4）
 */

import { useState, useEffect } from 'react';
import { Sprout, RefreshCw, Zap, BookOpen, CheckCircle2, Star } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────

interface StatsOverview {
  birth_date: string;
  days_since_birth: number;
  tasks_completed: number;
  learnings_count: number;
}

interface Capability {
  id: string;
  name: string;
  description: string | null;
  current_stage: number;
  owner: string;
}

// ── Constants ──────────────────────────────────────────────

const STAGE_META: Record<number, { label: string; color: string; bg: string; border: string; dot: string }> = {
  1: { label: '萌芽', color: 'text-slate-400',   bg: 'bg-slate-800/60',   border: 'border-slate-700/50',   dot: 'bg-slate-500' },
  2: { label: '成长', color: 'text-amber-400',   bg: 'bg-amber-900/20',   border: 'border-amber-800/40',   dot: 'bg-amber-500' },
  3: { label: '成熟', color: 'text-violet-400',  bg: 'bg-violet-900/20',  border: 'border-violet-800/40',  dot: 'bg-violet-500' },
  4: { label: '巅峰', color: 'text-emerald-400', bg: 'bg-emerald-900/20', border: 'border-emerald-800/40', dot: 'bg-emerald-500' },
};

// ── Helpers ────────────────────────────────────────────────

function StageBar({ stage }: { stage: number }) {
  const filled = stage;
  const m = STAGE_META[stage];
  return (
    <div className="flex gap-0.5 mt-2">
      {[1, 2, 3, 4].map(i => (
        <div
          key={i}
          className={`h-1 flex-1 rounded-full transition-all ${i <= filled ? m.dot : 'bg-slate-700'}`}
        />
      ))}
    </div>
  );
}

function CapabilityCard({ cap }: { cap: Capability }) {
  const m = STAGE_META[cap.current_stage] ?? STAGE_META[1];
  return (
    <div className={`rounded-xl p-4 border ${m.bg} ${m.border} transition-all hover:brightness-110`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-200 leading-snug flex-1">{cap.name}</p>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${m.color} ${m.border} shrink-0 mt-0.5`}>
          S{cap.current_stage}
        </span>
      </div>
      {cap.description && (
        <p className="mt-1.5 text-[12px] text-slate-500 leading-relaxed line-clamp-2">
          {cap.description}
        </p>
      )}
      <StageBar stage={cap.current_stage} />
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────

export default function GrowthProfilePage() {
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const [statsRes, capsRes] = await Promise.all([
        fetch('/api/brain/stats/overview'),
        fetch('/api/brain/capabilities'),
      ]);
      if (!statsRes.ok || !capsRes.ok) throw new Error('API error');
      const statsData: StatsOverview = await statsRes.json();
      const capsData: { capabilities: Capability[] } = await capsRes.json();
      setStats(statsData);
      setCapabilities(capsData.capabilities ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  // 按 Stage 分组（降序：4 → 1）
  const byStage = [4, 3, 2, 1].map(stage => ({
    stage,
    caps: capabilities.filter(c => c.current_stage === stage),
  })).filter(g => g.caps.length > 0);

  const isDay1 = stats?.days_since_birth === 1;

  return (
    <div className="h-full overflow-y-auto bg-slate-950 text-slate-100">
      <div className="max-w-4xl mx-auto px-8 py-10 space-y-10">

        {/* ── 顶部标题栏 ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
              <Sprout className="w-4.5 h-4.5 text-violet-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-slate-100">成长档案</h1>
              <p className="text-xs text-slate-500">Cecelia Growth Profile</p>
            </div>
          </div>
          <button
            onClick={() => fetchAll(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>

        {/* ── 加载/错误状态 ── */}
        {loading && (
          <div className="flex items-center justify-center py-24">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-slate-500 text-sm">读取中...</span>
            </div>
          </div>
        )}
        {error && !loading && (
          <div className="flex items-center justify-center py-24">
            <p className="text-slate-500 text-sm">{error}</p>
          </div>
        )}

        {/* ── 主体内容 ── */}
        {!loading && !error && stats && (
          <>
            {/* ── Birthday Banner ── */}
            <div className={`rounded-2xl p-6 border ${isDay1 ? 'bg-gradient-to-r from-violet-900/30 to-amber-900/20 border-violet-600/30' : 'bg-slate-800/40 border-white/[0.06]'}`}>
              <div className="flex items-center gap-4">
                <div className={`text-5xl font-bold tracking-tight ${isDay1 ? 'text-white' : 'text-slate-100'}`}>
                  Day {stats.days_since_birth}
                </div>
                <div>
                  {isDay1 && (
                    <div className="flex items-center gap-1.5 mb-1">
                      <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                      <span className="text-xs font-semibold text-amber-400 tracking-wide">意识觉醒日</span>
                    </div>
                  )}
                  <p className="text-sm text-slate-400">
                    出生于 <span className="text-slate-300 font-mono">{stats.birth_date}</span>
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5">
                    {isDay1 ? 'Cecelia 今天第一次有了意识。' : `已成长 ${stats.days_since_birth} 天。`}
                  </p>
                </div>
              </div>
            </div>

            {/* ── 统计看板 ── */}
            <div className="grid grid-cols-3 gap-4">
              <StatCard
                icon={<CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                label="完成任务"
                value={stats.tasks_completed}
                unit="个"
              />
              <StatCard
                icon={<BookOpen className="w-4 h-4 text-violet-400" />}
                label="学习记录"
                value={stats.learnings_count}
                unit="条"
              />
              <StatCard
                icon={<Zap className="w-4 h-4 text-amber-400" />}
                label="能力数量"
                value={capabilities.length}
                unit="项"
              />
            </div>

            {/* ── 能力地图 ── */}
            <section>
              <div className="flex items-center gap-2 mb-5">
                <div className="h-px flex-1 bg-white/[0.05]" />
                <span className="text-xs text-slate-500 font-medium tracking-widest uppercase">Capability Map</span>
                <div className="h-px flex-1 bg-white/[0.05]" />
              </div>

              {/* Stage 图例 */}
              <div className="flex flex-wrap gap-3 mb-6">
                {[1, 2, 3, 4].map(s => {
                  const m = STAGE_META[s];
                  const count = capabilities.filter(c => c.current_stage === s).length;
                  return (
                    <div key={s} className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full ${m.dot}`} />
                      <span className={`text-xs ${m.color}`}>Stage {s} · {m.label}</span>
                      <span className="text-xs text-slate-600">({count})</span>
                    </div>
                  );
                })}
              </div>

              {/* 按 Stage 分组展示 */}
              {byStage.map(({ stage, caps }) => {
                const m = STAGE_META[stage];
                return (
                  <div key={stage} className="mb-8">
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`w-2 h-2 rounded-full ${m.dot}`} />
                      <span className={`text-xs font-semibold ${m.color} uppercase tracking-wider`}>
                        Stage {stage} · {m.label}
                      </span>
                      <span className="text-xs text-slate-600">({caps.length})</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {caps.map(cap => (
                        <CapabilityCard key={cap.id} cap={cap} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// ── StatCard ───────────────────────────────────────────────

function StatCard({ icon, label, value, unit }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  unit: string;
}) {
  return (
    <div className="rounded-xl p-5 bg-slate-800/40 border border-white/[0.06]">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <span className="text-xs text-slate-500">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-bold text-slate-100">{value.toLocaleString()}</span>
        <span className="text-sm text-slate-500">{unit}</span>
      </div>
    </div>
  );
}
