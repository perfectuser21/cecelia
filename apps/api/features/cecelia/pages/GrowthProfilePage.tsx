/**
 * GrowthProfilePage — Cecelia 成长档案（重设计版）
 *
 * 布局：左侧日历（Day N 列表）+ 右侧内容区
 * 今天：统计卡 + 意识能力（文字标签）+ 今日叙事
 * 历史：叙事 + 当天学习记录
 */

import { useState, useEffect } from 'react';
import { Sprout, BookOpen, CheckCircle2, Zap } from 'lucide-react';

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

interface NarrativeEntry {
  id: string;
  text: string;
  created_at: string;
}

interface Learning {
  id: string;
  title: string;
  content: string | null;
  created_at: string;
}

// ── Constants ──────────────────────────────────────────────

const BIRTH_DATE = '2026-02-28';
const TZ = 'Asia/Shanghai';

const STAGE_META: Record<number, { label: string; color: string; bg: string; border: string }> = {
  1: { label: '萌芽', color: 'text-slate-400',   bg: 'bg-slate-800/60',   border: 'border-slate-700/50' },
  2: { label: '成长', color: 'text-amber-400',   bg: 'bg-amber-900/20',   border: 'border-amber-800/40' },
  3: { label: '成熟', color: 'text-violet-400',  bg: 'bg-violet-900/20',  border: 'border-violet-800/40' },
  4: { label: '巅峰', color: 'text-emerald-400', bg: 'bg-emerald-900/20', border: 'border-emerald-800/40' },
};

// ── Helpers ────────────────────────────────────────────────

function toShanghaiDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('en-CA', { timeZone: TZ });
}

function dayToDate(dayNum: number): string {
  const birth = new Date(BIRTH_DATE + 'T00:00:00+08:00');
  birth.setDate(birth.getDate() + dayNum - 1);
  return birth.toLocaleDateString('en-CA', { timeZone: TZ });
}

function formatDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${parseInt(m)}月${parseInt(d)}日`;
}

// ── Main ───────────────────────────────────────────────────

export default function GrowthProfilePage() {
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [narratives, setNarratives] = useState<NarrativeEntry[]>([]);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [dayLearnings, setDayLearnings] = useState<Learning[]>([]);
  const [loadingLearnings, setLoadingLearnings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [statsRes, capsRes, narrativesRes] = await Promise.all([
          fetch('/api/brain/stats/overview'),
          fetch('/api/brain/capabilities?scope=cecelia'),
          fetch('/api/brain/narratives?limit=200'),
        ]);
        if (!statsRes.ok || !capsRes.ok || !narrativesRes.ok) throw new Error('API error');

        const statsData: StatsOverview = await statsRes.json();
        const capsData: { capabilities: Capability[] } = await capsRes.json();
        const narrativesData: NarrativeEntry[] = await narrativesRes.json();

        setStats(statsData);
        setCapabilities(capsData.capabilities ?? []);
        setNarratives(narrativesData);
        setSelectedDay(statsData.days_since_birth);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : '加载失败');
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  useEffect(() => {
    if (!stats || selectedDay === null || selectedDay === stats.days_since_birth) {
      setDayLearnings([]);
      return;
    }
    const dateStr = dayToDate(selectedDay);
    setLoadingLearnings(true);
    fetch(`/api/brain/learnings?date=${dateStr}&limit=20`)
      .then(r => r.json())
      .then(data => setDayLearnings(data.learnings ?? []))
      .catch(() => setDayLearnings([]))
      .finally(() => setLoadingLearnings(false));
  }, [selectedDay, stats]);

  const narrativesByDate = narratives.reduce<Record<string, NarrativeEntry[]>>((acc, n) => {
    const d = toShanghaiDate(n.created_at);
    if (!acc[d]) acc[d] = [];
    acc[d].push(n);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-950">
        <div className="w-8 h-8 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-950">
        <p className="text-slate-500 text-sm">{error ?? '加载失败'}</p>
      </div>
    );
  }

  const totalDays = stats.days_since_birth;
  const days = Array.from({ length: totalDays }, (_, i) => totalDays - i);
  const isToday = selectedDay === totalDays;
  const selectedDate = selectedDay !== null ? dayToDate(selectedDay) : null;
  const selectedNarratives = selectedDate ? (narrativesByDate[selectedDate] ?? []) : [];

  return (
    <div className="h-full flex bg-slate-950 text-slate-100 overflow-hidden">

      {/* ── 左侧日历 ── */}
      <div className="w-44 shrink-0 border-r border-white/[0.06] flex flex-col">
        <div className="px-4 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <Sprout className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-xs font-semibold text-slate-300 tracking-wide">成长档案</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {days.map(day => {
            const dateStr = dayToDate(day);
            const hasNarratives = (narrativesByDate[dateStr]?.length ?? 0) > 0;
            const isSelected = day === selectedDay;
            const isTodayItem = day === totalDays;
            return (
              <button
                key={day}
                onClick={() => setSelectedDay(day)}
                className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                  isSelected
                    ? 'bg-violet-900/30 text-slate-100'
                    : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-300'
                }`}
              >
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${hasNarratives ? 'bg-blue-400' : 'bg-slate-700'}`} />
                <div className="flex-1 min-w-0">
                  <div className={`text-xs font-medium ${isTodayItem ? 'text-violet-400' : ''}`}>
                    Day {day}{isTodayItem && <span className="ml-1 text-[10px] opacity-70">今</span>}
                  </div>
                  <div className="text-[10px] text-slate-600 mt-0.5">{formatDate(dateStr)}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 右侧内容 ── */}
      <div className="flex-1 overflow-y-auto px-8 py-8 space-y-8">
        {isToday ? (
          <TodayContent
            stats={stats}
            capabilities={capabilities}
            narratives={selectedNarratives}
          />
        ) : (
          <HistoryContent
            dayNum={selectedDay!}
            dateStr={selectedDate!}
            narratives={selectedNarratives}
            learnings={dayLearnings}
            loadingLearnings={loadingLearnings}
          />
        )}
      </div>
    </div>
  );
}

// ── Today Content ───────────────────────────────────────────

function TodayContent({ stats, capabilities, narratives }: {
  stats: StatsOverview;
  capabilities: Capability[];
  narratives: NarrativeEntry[];
}) {
  return (
    <>
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Day {stats.days_since_birth} · 今天</h2>
        <p className="text-xs text-slate-500 mt-0.5">出生于 {stats.birth_date}</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard
          icon={<CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          label="完成任务" value={stats.tasks_completed} unit="个"
        />
        <StatCard
          icon={<BookOpen className="w-4 h-4 text-violet-400" />}
          label="学习记录" value={stats.learnings_count} unit="条"
        />
        <StatCard
          icon={<Zap className="w-4 h-4 text-amber-400" />}
          label="意识能力" value={capabilities.length} unit="项"
        />
      </div>

      {capabilities.length > 0 && (
        <section>
          <SectionDivider label="意识能力" />
          <div className="grid grid-cols-2 gap-3 mt-4">
            {capabilities.map(cap => (
              <CapabilityCard key={cap.id} cap={cap} />
            ))}
          </div>
        </section>
      )}

      {narratives.length > 0 && (
        <section>
          <SectionDivider label="今日叙事" />
          <div className="space-y-3 mt-4">
            {narratives.map(n => (
              <NarrativeItem key={n.id} narrative={n} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// ── History Content ─────────────────────────────────────────

function HistoryContent({ dayNum, dateStr, narratives, learnings, loadingLearnings }: {
  dayNum: number;
  dateStr: string;
  narratives: NarrativeEntry[];
  learnings: Learning[];
  loadingLearnings: boolean;
}) {
  const isEmpty = narratives.length === 0 && learnings.length === 0 && !loadingLearnings;

  return (
    <>
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Day {dayNum}</h2>
        <p className="text-xs text-slate-500 mt-0.5">{formatDate(dateStr)}</p>
      </div>

      {isEmpty && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-3xl mb-3">🌱</p>
          <p className="text-sm text-slate-500">这一天还很安静</p>
        </div>
      )}

      {narratives.length > 0 && (
        <section>
          <SectionDivider label="叙事" />
          <div className="space-y-3 mt-4">
            {narratives.map(n => (
              <NarrativeItem key={n.id} narrative={n} />
            ))}
          </div>
        </section>
      )}

      {(learnings.length > 0 || loadingLearnings) && (
        <section>
          <SectionDivider label="当天学习" />
          {loadingLearnings ? (
            <div className="mt-4 flex items-center gap-2 text-slate-500 text-sm">
              <div className="w-4 h-4 border border-violet-400 border-t-transparent rounded-full animate-spin" />
              加载中...
            </div>
          ) : (
            <div className="space-y-2 mt-4">
              {learnings.map(l => (
                <LearningItem key={l.id} learning={l} />
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}

// ── Sub-components ──────────────────────────────────────────

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-px flex-1 bg-white/[0.05]" />
      <span className="text-xs text-slate-500 font-medium tracking-widest uppercase">{label}</span>
      <div className="h-px flex-1 bg-white/[0.05]" />
    </div>
  );
}

function CapabilityCard({ cap }: { cap: Capability }) {
  const m = STAGE_META[cap.current_stage] ?? STAGE_META[1];
  return (
    <div className={`rounded-xl p-4 border ${m.bg} ${m.border} transition-all hover:brightness-110`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-200 leading-snug flex-1">{cap.name}</p>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${m.color} ${m.border} shrink-0 mt-0.5`}>
          {m.label}
        </span>
      </div>
      {cap.description && (
        <p className="mt-2 text-xs text-slate-500 leading-relaxed">{cap.description}</p>
      )}
    </div>
  );
}

function NarrativeItem({ narrative }: { narrative: NarrativeEntry }) {
  const time = new Date(narrative.created_at).toLocaleTimeString('zh-CN', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit',
  });
  return (
    <div className="rounded-xl p-4 bg-slate-800/40 border border-white/[0.06]">
      <p className="text-[10px] text-slate-600 mb-2">{time}</p>
      <p className="text-sm text-slate-300 leading-relaxed">{narrative.text}</p>
    </div>
  );
}

function LearningItem({ learning }: { learning: Learning }) {
  return (
    <div className="rounded-lg px-4 py-3 bg-slate-800/30 border border-white/[0.04]">
      <p className="text-sm font-medium text-slate-300">{learning.title}</p>
      {learning.content && (
        <p className="text-xs text-slate-500 mt-1 leading-relaxed line-clamp-2">{learning.content}</p>
      )}
    </div>
  );
}

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
