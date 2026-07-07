/**
 * WarRoomPanels — 战情室四板块（relay-baton4 item2）
 *
 *   BattleBanner   战况横幅（/harness/stats?by=journey&days=30）+ 哨兵灯（/sentinel/health）
 *   HandoffStream  接力史流（/api/brain/handoffs）
 *   DecisionStream 决策流（/api/brain/decisions?made_by=user）
 *
 * 每板块独立 fetch + 60s 轮询 + 失败静默降级（返回 null / 空态，不影响主 feed）。
 * 纯函数导出供单测；relativeTime/verdictMeta/absoluteShanghai 复用 WarRoomPage 导出
 * （循环 import 安全：均为函数声明，仅在渲染期调用，无模块初始化期引用）。
 */
import { useEffect, useState } from 'react';
import { Gavel, ArrowRightLeft } from 'lucide-react';
import { relativeTime, verdictMeta, absoluteShanghai } from './WarRoomPage';

// ====================== 纯函数（单测覆盖） ======================

/** 成功率 0-1 小数 → 整数百分比串；空/非数 → "—" */
export function pctLabel(rate: unknown): string {
  if (rate == null) return '—';
  const n = Number(rate);
  if (Number.isNaN(n)) return '—';
  return `${Math.round(n * 100)}%`;
}

const FAILURE_CLIP = 36;

export interface JourneyStatRow {
  journey_id: string; name: string; runs: number; pct: string;
  last_run_at: string | null; failure_short: string; failure_full: string; hasFailure: boolean;
}

/** /harness/stats?by=journey 响应 → 战况 chip 行；last_failure 压单行截断（原文进 title） */
export function journeyStatRows(stats: unknown): JourneyStatRow[] {
  const js = (stats as { journeys?: unknown })?.journeys;
  if (!Array.isArray(js)) return [];
  return js.map((j) => {
    const failureFull = typeof j?.last_failure === 'string' ? j.last_failure : '';
    const oneLine = failureFull.replace(/\s+/g, ' ').trim();
    return {
      journey_id: String(j?.journey_id ?? ''),
      name: String(j?.journey_name ?? ''),
      runs: Number(j?.runs) || 0,
      pct: pctLabel(j?.success_rate),
      last_run_at: j?.last_run_at ?? null,
      failure_short: oneLine.length > FAILURE_CLIP ? `${oneLine.slice(0, FAILURE_CLIP)}…` : oneLine,
      failure_full: failureFull,
      hasFailure: oneLine.length > 0,
    };
  });
}

export interface HandoffRow {
  task_id: string; title: string; verdict: string | null; next_step: string; created_at: string | null;
}

/** /api/brain/handoffs 响应（{handoffs,total} 包装）→ 卡片行；next_step 取 next_steps[0] */
export function handoffRows(resp: unknown): HandoffRow[] {
  const hs = (resp as { handoffs?: unknown })?.handoffs;
  if (!Array.isArray(hs)) return [];
  return hs.map((h) => ({
    task_id: String(h?.task_id ?? ''),
    title: String(h?.title ?? ''),
    verdict: h?.verdict ?? null,
    next_step: Array.isArray(h?.next_steps) && h.next_steps.length ? String(h.next_steps[0]) : '',
    created_at: h?.created_at ?? null,
  }));
}

export interface DecisionRow { id: string; topic: string; date: string }

/** /api/brain/decisions 响应（裸数组）→ topic + 上海日期（YYYY-MM-DD）行 */
export function decisionRows(rows: unknown): DecisionRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((d) => ({
    id: String(d?.id ?? ''),
    topic: String(d?.topic ?? ''),
    date: absoluteShanghai(d?.created_at ?? null).slice(0, 10),
  }));
}

export type SentinelColor = 'green' | 'yellow';
/** 与后端 routes/sentinel.js STALE_SECONDS 同值（前端自算 healthy 的过期线） */
export const SENTINEL_STALE_SECONDS = 1800;

/** 单 job → 灯色：ok===true 且 age_seconds<=1800 绿，否则黄 */
export function sentinelLight(job: { ok?: unknown; age_seconds?: unknown } | null | undefined): SentinelColor {
  if (!job) return 'yellow';
  const age = Number(job.age_seconds);
  return job.ok === true && Number.isFinite(age) && age <= SENTINEL_STALE_SECONDS ? 'green' : 'yellow';
}

export interface SentinelSummary {
  lights: Array<{ name: string; light: SentinelColor; age_seconds: number | null }>;
  expected: number | null;
  healthy: boolean;
}

/** /sentinel/health 响应 → 灯组 + 自算 healthy（全绿 且 灯数>=expected 且 expected 非空） */
export function sentinelRows(resp: unknown): SentinelSummary {
  const jobs = (resp as { jobs?: unknown })?.jobs;
  const expRaw = (resp as { expected?: unknown })?.expected;
  const expNum = Number(expRaw);
  const expected = expRaw == null || Number.isNaN(expNum) ? null : expNum;
  const list = Array.isArray(jobs) ? jobs : [];
  const lights = list.map((j) => {
    const age = Number(j?.age_seconds);
    return {
      name: String(j?.name ?? ''),
      light: sentinelLight(j),
      age_seconds: Number.isFinite(age) ? age : null,
    };
  });
  const healthy = expected !== null && lights.length >= expected && lights.every((l) => l.light === 'green');
  return { lights, expected, healthy };
}

// ====================== 数据钩子 ======================

/** 轮询 GET：失败静默置 null（板块自行降级），60s 间隔，卸载清理 */
function usePolled<T>(url: string, intervalMs = 60_000): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as T;
        if (alive) setData(json);
      } catch {
        if (alive) setData(null);
      }
    };
    load();
    const t = setInterval(load, intervalMs);
    return () => { alive = false; clearInterval(t); };
  }, [url, intervalMs]);
  return data;
}

// ====================== 组件 ======================

/** 战况横幅：30 天每线 run 数/成功率/最近一跑 + 右端哨兵灯。两路数据全空则整条隐藏。 */
export function BattleBanner() {
  const stats = usePolled<unknown>('/api/brain/harness/stats?by=journey&days=30');
  const sentinel = usePolled<unknown>('/api/brain/sentinel/health');
  const rows = journeyStatRows(stats);
  const sen = sentinelRows(sentinel);
  if (rows.length === 0 && sen.lights.length === 0) return null;
  return (
    <div className="flex items-center gap-3 h-9 px-4 border-b border-slate-800/60 bg-slate-900/40 flex-shrink-0 text-[12px]">
      <span className="text-[11px] tracking-[0.12em] uppercase text-slate-600 font-bold flex-shrink-0">战况 30D</span>
      <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto">
        {rows.length === 0 && <span className="text-slate-700">暂无 30 天战况</span>}
        {rows.map((r) => (
          <div
            key={r.journey_id}
            title={r.hasFailure ? `最近失败：${r.failure_full}` : (r.last_run_at ? `最近一跑：${absoluteShanghai(r.last_run_at)}` : '')}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-slate-800/80 bg-slate-900/60 flex-shrink-0"
          >
            {r.hasFailure && <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />}
            <span className="text-slate-400 truncate max-w-[160px]">{r.name}</span>
            <span className="font-mono text-slate-500">{r.runs}跑</span>
            <span className={`font-mono ${r.pct === '—' ? 'text-slate-600' : 'text-emerald-400'}`}>{r.pct}</span>
            {r.last_run_at && <span className="text-slate-700">{relativeTime(r.last_run_at)}</span>}
          </div>
        ))}
      </div>
      {sen.lights.length > 0 && (
        <div className="flex items-center gap-1.5 flex-shrink-0 pl-3 border-l border-slate-800/60">
          <span className="text-[11px] tracking-wider uppercase text-slate-600 font-bold">哨兵</span>
          {sen.lights.map((l) => (
            <span
              key={l.name}
              title={`${l.name} · ${l.age_seconds != null ? `${l.age_seconds}s 前` : '未知'}`}
              className={`w-2 h-2 rounded-full ${l.light === 'green' ? 'bg-emerald-500' : 'bg-amber-400'}`}
            />
          ))}
          {!sen.healthy && <span className="text-red-400 font-semibold">哨兵异常</span>}
        </div>
      )}
    </div>
  );
}

/** 接力史流：最近交接单卡片（verdict 徽章 + next_steps 第一条） */
export function HandoffStream() {
  const resp = usePolled<unknown>('/api/brain/handoffs?limit=8');
  const rows = handoffRows(resp);
  return (
    <div className="rounded-lg border border-slate-800/60 bg-slate-900/20 p-3">
      <div className="flex items-center gap-2 mb-2">
        <ArrowRightLeft className="w-3.5 h-3.5 text-violet-400" />
        <span className="text-[12px] tracking-[0.1em] uppercase text-slate-400 font-bold">接力史</span>
        <span className="text-[11px] text-slate-700 font-mono">{rows.length} 单</span>
      </div>
      {rows.length === 0 ? (
        <div className="text-[12px] text-slate-700">暂无交接单</div>
      ) : (
        <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
          {rows.map((h) => {
            const v = verdictMeta(h.verdict);
            return (
              <div key={h.task_id} className="text-[12px] leading-snug">
                <div className="flex items-center gap-1.5">
                  {v && <span className={`text-[10px] tracking-wide px-1 py-px rounded font-bold flex-shrink-0 ${v.pill}`}>{v.label}</span>}
                  <span className="text-slate-300 truncate" title={h.title}>{h.title}</span>
                  <span className="ml-auto text-slate-700 flex-shrink-0" title={absoluteShanghai(h.created_at)}>{relativeTime(h.created_at)}</span>
                </div>
                {h.next_step && (
                  <div className="text-slate-600 truncate pl-0.5" title={h.next_step}>➡️ {h.next_step}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 决策流：主理人最近拍板（topic + 上海日期） */
export function DecisionStream() {
  const resp = usePolled<unknown>('/api/brain/decisions?made_by=user&limit=8');
  const rows = decisionRows(resp);
  return (
    <div className="rounded-lg border border-slate-800/60 bg-slate-900/20 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Gavel className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-[12px] tracking-[0.1em] uppercase text-slate-400 font-bold">主理人拍板</span>
        <span className="text-[11px] text-slate-700 font-mono">{rows.length} 条</span>
      </div>
      {rows.length === 0 ? (
        <div className="text-[12px] text-slate-700">暂无决策</div>
      ) : (
        <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
          {rows.map((d) => (
            <div key={d.id} className="flex items-center gap-2 text-[12px]">
              <span className="text-slate-300 truncate" title={d.topic}>{d.topic}</span>
              <span className="ml-auto text-slate-700 font-mono flex-shrink-0">{d.date}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
