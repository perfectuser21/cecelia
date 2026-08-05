/**
 * StrategistPage — 军师台入口（线列表）
 *
 * 路由：/strategist
 * 布局：深色全高，按 Area 分组展示各条 Line（健康分 + 红点）
 * 点击一条 Line → /strategist/:lineId（线空间七页签）
 */

import { useEffect, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Zap, Server, Layers, CircleDot, RefreshCw, ChevronRight, Clock, Cpu,
} from 'lucide-react';
import { shanghaiClock } from '../warroom/WarRoomPage';

// ── 类型 ─────────────────────────────────────────────────────────────────────

interface LineSummary {
  id: string;
  name: string;
  status: string;
  maturity?: string | null;
  step_total?: number;
  step_done?: number;
  running?: number;
  task_total?: number;
  last_activity?: string | null;
}

interface LineArea {
  areaKey: string;
  areaName: string;
  lines: LineSummary[];
}

// ── 纯函数 ────────────────────────────────────────────────────────────────────

const MATURITY_SCORE: Record<string, number> = {
  not_started: 0, skeleton: 25, mvp: 60, live: 85, stable: 100,
};

export function healthScore(line: Pick<LineSummary, 'maturity' | 'step_total' | 'step_done'>): number {
  const mat = MATURITY_SCORE[line.maturity ?? ''] ?? 0;
  const total = line.step_total ?? 0;
  if (total === 0) return mat;
  const prog = Math.min(100, Math.round(((line.step_done ?? 0) / total) * 100));
  return Math.round(0.6 * prog + 0.4 * mat);
}

export function healthMeta(score: number): { ring: string; text: string; bg: string } {
  if (score >= 70) return { ring: 'stroke-emerald-500', text: 'text-emerald-400', bg: 'bg-emerald-500/10' };
  if (score >= 40) return { ring: 'stroke-amber-400', text: 'text-amber-400', bg: 'bg-amber-500/10' };
  return { ring: 'stroke-red-500', text: 'text-red-400', bg: 'bg-red-500/10' };
}

const MATURITY_LABEL: Record<string, string> = {
  not_started: '待启', skeleton: '骨架', mvp: 'MVP', live: '上线', stable: '稳定',
};

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  return `${Math.floor(h / 24)}天前`;
}

// ── HealthRing：SVG 健康分圆环 ─────────────────────────────────────────────────

function HealthRing({ score }: { score: number }) {
  const r = 14;
  const circ = 2 * Math.PI * r;
  const meta = healthMeta(score);
  const fill = (score / 100) * circ;
  return (
    <div className="relative flex-shrink-0 w-9 h-9 flex items-center justify-center">
      <svg viewBox="0 0 36 36" className="w-9 h-9 -rotate-90" style={{ overflow: 'visible' }}>
        <circle cx="18" cy="18" r={r} fill="none" stroke="#1e293b" strokeWidth="3" />
        <circle
          cx="18" cy="18" r={r} fill="none"
          className={meta.ring}
          strokeWidth="3"
          strokeDasharray={`${fill} ${circ - fill}`}
          strokeLinecap="round"
        />
      </svg>
      <span className={`absolute text-[11px] font-bold font-mono ${meta.text}`}>{score}</span>
    </div>
  );
}

// ── LineCard ─────────────────────────────────────────────────────────────────

const AREA_ICON: Record<string, typeof Server> = { cecelia: Server, zenithjoy: Layers, infrastructure: Cpu };
const AREA_ACCENT: Record<string, string> = { cecelia: 'text-cyan-500', zenithjoy: 'text-amber-500', infrastructure: 'text-emerald-500' };

function LineCard({ line, onClick }: { line: LineSummary; onClick: () => void }) {
  const score = healthScore(line);
  const meta = healthMeta(score);
  const running = Number(line.running) || 0;
  const hot = running > 0;
  const matLabel = MATURITY_LABEL[line.maturity ?? ''] ?? (line.maturity ?? '');

  return (
    <button
      onClick={onClick}
      className="w-full group flex items-center gap-3 px-4 py-3 rounded-lg border border-slate-800/60 bg-slate-900/20 hover:bg-slate-800/30 hover:border-slate-700/60 transition-all text-left"
    >
      {/* 红点 / 活跃指示 */}
      <div className="flex-shrink-0 w-2 h-2 rounded-full mt-0.5">
        {hot
          ? <div className="w-2 h-2 rounded-full bg-blue-400 wr-pulse" />
          : <div className="w-2 h-2 rounded-full bg-slate-700/60" />}
      </div>

      {/* 主体 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[14px] font-semibold text-slate-200 truncate">{line.name}</span>
          {matLabel && (
            <span className="text-[11px] px-1.5 py-px rounded border border-slate-700 text-slate-500 flex-shrink-0">
              {matLabel}
            </span>
          )}
          {hot && (
            <span className="text-[11px] font-mono px-1.5 py-px rounded bg-blue-500/15 text-blue-300 border border-blue-500/25 flex-shrink-0">
              {running} 跑
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1 text-[12px]">
          {(line.step_total ?? 0) > 0 && (
            <>
              <div className="h-[3px] w-20 rounded-full bg-slate-800 overflow-hidden flex-shrink-0">
                <div
                  className={`h-full rounded-full ${meta.bg.replace('/10', '/60')}`}
                  style={{ width: `${Math.min(100, Math.round(((line.step_done ?? 0) / (line.step_total ?? 1)) * 100))}%` }}
                />
              </div>
              <span className="text-slate-600 font-mono">{line.step_done}/{line.step_total}</span>
              <span className="text-slate-800">·</span>
            </>
          )}
          {line.last_activity && (
            <span className="text-slate-600">{relativeTime(line.last_activity)}</span>
          )}
        </div>
      </div>

      {/* 右侧：健康分圆环 */}
      <HealthRing score={score} />

      {/* 展开箭头 */}
      <ChevronRight className="w-3.5 h-3.5 text-slate-700 group-hover:text-slate-400 transition-colors flex-shrink-0" />
    </button>
  );
}

// ── 样式注入 ──────────────────────────────────────────────────────────────────

const ST_STYLE = `
@keyframes wr-blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
@keyframes wr-pulse-ring { 0%{box-shadow:0 0 0 0 rgba(59,130,246,0.4)} 70%{box-shadow:0 0 0 5px rgba(59,130,246,0)} 100%{box-shadow:0 0 0 0 rgba(59,130,246,0)} }
.wr-pulse { animation: wr-blink 1.3s ease-in-out infinite, wr-pulse-ring 2s infinite; }
.st-root ::-webkit-scrollbar { width:3px; height:3px; }
.st-root ::-webkit-scrollbar-thumb { background:#1e293b; border-radius:9px; }
`;

// ── 主页面 ────────────────────────────────────────────────────────────────────

// Fix-5: smoke 行过滤正则
const SMOKE_RE = [/^\[smoke\]/i, /^gp-agg-smoke/i];

export default function StrategistPage() {
  const navigate = useNavigate();
  const [areas, setAreas] = useState<LineArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState('');
  // Fix-4: 全貌页数字行四格
  const [panoNums, setPanoNums] = useState({ features: 0, gp: 0, decisions: 0, activeTasks: 0 });

  const fetchLines = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const res = await fetch('/api/brain/warroom/lines');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Fix-5: 过滤 smoke 前缀行
      const filtered = (Array.isArray(data?.areas) ? data.areas : []).map((area: LineArea) => ({
        ...area,
        lines: area.lines.filter((l: LineSummary) => !SMOKE_RE.some(re => re.test(l.name))),
      }));
      setAreas(filtered);
    } catch {
      // 加载失败时保留旧数据，不清空
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLines();
    const poll = setInterval(() => fetchLines(true), 30_000);
    return () => clearInterval(poll);
  }, [fetchLines]);

  // Fix-4: 并发拉取四格数字
  useEffect(() => {
    (async () => {
      try {
        const [featRes, gpRes, decRes, taskRes] = await Promise.allSettled([
          fetch('/api/brain/features?limit=1').then(r => r.json()),
          fetch('/api/brain/golden-paths?limit=1').then(r => r.json()),
          fetch('/api/brain/decisions?status=active&limit=1').then(r => r.json()),
          fetch('/api/brain/tasks?status=in_progress&limit=1').then(r => r.json()),
        ]);
        setPanoNums({
          features: featRes.status === 'fulfilled' ? (featRes.value.total ?? featRes.value.items?.length ?? 0) : 0,
          gp: gpRes.status === 'fulfilled' ? (gpRes.value.total ?? gpRes.value.items?.length ?? 0) : 0,
          decisions: decRes.status === 'fulfilled' ? (decRes.value.total ?? decRes.value.items?.length ?? 0) : 0,
          activeTasks: taskRes.status === 'fulfilled' ? (taskRes.value.total ?? taskRes.value.items?.length ?? 0) : 0,
        });
      } catch { /* 静默失败 */ }
    })();
  }, []);

  useEffect(() => {
    const tick = () => setClock(shanghaiClock());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const totalLines = areas.reduce((n, a) => n + a.lines.length, 0);
  const totalRunning = areas.reduce(
    (n, a) => n + a.lines.reduce((m, l) => m + (Number(l.running) || 0), 0), 0,
  );

  return (
    <div className="st-root flex flex-col h-full bg-[#0a0e1a] text-slate-400 font-mono select-none">
      <style>{ST_STYLE}</style>

      {/* ── 顶栏 ── */}
      <div className="flex items-center h-9 px-4 border-b border-slate-800/80 bg-slate-900/60 flex-shrink-0 gap-4 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
            <Zap className="w-2.5 h-2.5 text-white" />
          </div>
          <span className="text-slate-300 font-semibold tracking-wider">军师台 STRATEGIST</span>
        </div>
        <div className="h-3 w-px bg-slate-800" />
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-slate-400" />
            <span className="text-slate-300 font-mono">{totalLines}</span>
            <span className="text-slate-600">条线</span>
          </div>
          {totalRunning > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 wr-pulse" />
              <span className="text-blue-300 font-mono">{totalRunning}</span>
              <span className="text-slate-600">运行中</span>
            </div>
          )}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-slate-600 font-mono">{clock}</span>
          <button
            onClick={() => fetchLines()}
            className="text-slate-600 hover:text-slate-300 transition-colors"
            title="刷新"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── 数字行（Fix-4：四格数字行）── */}
      <div className="flex items-center gap-0 border-b border-slate-800/60 bg-slate-900/30 flex-shrink-0">
        {[
          { label: 'Features', value: panoNums.features, color: 'text-violet-400' },
          { label: 'GP数', value: panoNums.gp, color: 'text-emerald-400' },
          { label: '决策数', value: panoNums.decisions, color: 'text-amber-400' },
          { label: '在干活', value: panoNums.activeTasks, color: 'text-blue-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="flex-1 flex flex-col items-center py-2 border-r border-slate-800/40 last:border-r-0">
            <span className={`text-[18px] font-bold font-mono leading-none ${color}`}>{value}</span>
            <span className="text-[10px] text-slate-600 mt-0.5">{label}</span>
          </div>
        ))}
      </div>

      {/* ── 主内容 ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading && areas.length === 0 && (
          <div className="flex items-center gap-2 py-8 text-slate-600 text-sm">
            <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            加载线列表…
          </div>
        )}

        {!loading && areas.length === 0 && (
          <div className="py-8 text-slate-600 text-sm">暂无线数据</div>
        )}

        <div className="max-w-3xl space-y-8">
          {areas.map((area) => {
            if (area.lines.length === 0) return null;
            const Icon = AREA_ICON[area.areaKey] || CircleDot;
            const accent = AREA_ACCENT[area.areaKey] || 'text-slate-400';
            const areaRunning = area.lines.reduce((n, l) => n + (Number(l.running) || 0), 0);
            return (
              <div key={area.areaKey}>
                {/* Area 标题 */}
                <div className="flex items-center gap-2 mb-3">
                  <Icon className={`w-3.5 h-3.5 ${accent} flex-shrink-0`} />
                  <span className="text-[11px] tracking-[0.12em] uppercase font-bold text-slate-500">
                    {area.areaName}
                  </span>
                  <div className="flex-1 h-px bg-slate-800/60" />
                  <span className="text-[11px] text-slate-700">{area.lines.length} 条</span>
                  {areaRunning > 0 && (
                    <span className="text-[11px] font-mono px-1.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                      {areaRunning} 跑
                    </span>
                  )}
                </div>

                {/* Line 列表 */}
                <div className="space-y-2">
                  {area.lines.map((line) => (
                    <LineCard
                      key={line.id}
                      line={line}
                      onClick={() => navigate(`/strategist/${encodeURIComponent(line.id)}`)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* 底部说明 */}
        {areas.length > 0 && (
          <div className="mt-8 flex items-center gap-2 text-[11px] text-slate-700">
            <Clock className="w-3 h-3" />
            <span>健康分 = 规划进度 60% + 成熟度 40%，每 30s 自动刷新</span>
          </div>
        )}
      </div>
    </div>
  );
}
