/**
 * WarRoomGoldenPathPage — GP 二级页
 *
 * 路由：/warroom/gp/:gpId
 * 布局：双栏（左：GP 信息；右：ConversationsPanel with gpId 过滤）
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertCircle, Zap, RefreshCw } from 'lucide-react';
import ConversationsPanel from './ConversationsPanel';
import GoldenPathLedgerPanel, { type StepLedger } from './GoldenPathLedgerPanel';

// ── 类型 ─────────────────────────────────────────────────────────────────────

interface GoldenPath {
  id: string;
  name?: string | null;
  title?: string | null;
  one_liner?: string | null;
  status?: string | null;
  journey_id?: string | null;
  description?: string | null;
}

interface JourneyStep {
  id: string;
  step_number: number;
  promise?: string | null;
}

interface PageSnapshot {
  gp: GoldenPath | null;
  ledgers: StepLedger[];
  ledgerUnavailable: boolean;
  error: string | null;
}

const verificationStates = new Set(['verified', 'failed', 'never_run', 'not_executable']);
const ledgerZones = ['capability', 'element', 'scenario', 'base_ref'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isGoldenPath(value: unknown): value is GoldenPath {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    isNullableString(value.name ?? null) &&
    isNullableString(value.title ?? null) &&
    isNullableString(value.journey_id ?? null) &&
    isNullableString(value.status ?? null) &&
    isNullableString(value.one_liner ?? null) &&
    isNullableString(value.description ?? null);
}

function isJourneyStep(value: unknown): value is JourneyStep {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.step_number === 'number' &&
    Number.isFinite(value.step_number) &&
    isNullableString(value.promise ?? null);
}

function isCoverage(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = ['eligible', 'verified', 'failed', 'never_run', 'percent'];
  const validNumbers = keys.every((key) =>
    typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0
  );
  return validNumbers && (value.percent as number) <= 100;
}

function isVerification(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.state === 'string' &&
    verificationStates.has(value.state) &&
    typeof value.verified === 'boolean' &&
    value.verified === (value.state === 'verified') &&
    isNullableString(value.last_verified) &&
    isNullableString(value.last_run_at) &&
    isNullableString(value.receipt_id) &&
    isNullableString(value.run_id) &&
    isNullableString(value.source_sha) &&
    isNullableString(value.machine_id) &&
    typeof value.assertion_current === 'boolean';
}

function isLedgerCell(value: unknown, expectedZone: typeof ledgerZones[number]): boolean {
  return isRecord(value) &&
    typeof value.link_id === 'string' &&
    value.cell_kind === expectedZone &&
    typeof value.cell_key === 'string' &&
    typeof value.cell_status === 'string' &&
    isNullableString(value.assertion_ref) &&
    typeof value.assertion_state === 'string' &&
    isNullableString(value.na_reason) &&
    isVerification(value.verification);
}

function isStepLedger(value: unknown, expectedStep: JourneyStep): value is StepLedger {
  if (!isRecord(value) || !isRecord(value.step) || !isRecord(value.zones)) return false;
  const validStep = value.step.id === expectedStep.id &&
    typeof value.step.name === 'string' &&
    value.step.step_number === expectedStep.step_number &&
    isNullableString(value.step.promise ?? null);
  const validZones = ledgerZones.every((zone) =>
    Array.isArray(value.zones[zone]) &&
    value.zones[zone].every((cellValue) => isLedgerCell(cellValue, zone))
  );
  return validStep && validZones && isCoverage(value.coverage);
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(isRecord(body) && typeof body.error === 'string' ? body.error : `HTTP ${response.status}`);
  }
  return response.json();
}

// ── 主页面 ────────────────────────────────────────────────────────────────────

export default function WarRoomGoldenPathPage() {
  const { gpId } = useParams<{ gpId: string }>();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<PageSnapshot>({
    gp: null,
    ledgers: [],
    ledgerUnavailable: false,
    error: null,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const { gp, ledgers, ledgerUnavailable, error } = snapshot;

  const loadPage = useCallback(async (silent = false) => {
    if (!gpId) {
      setSnapshot({ gp: null, ledgers: [], ledgerUnavailable: false, error: 'GP 不存在或已归档' });
      setLoading(false);
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = ++generationRef.current;
    const isCurrent = () => generation === generationRef.current && !controller.signal.aborted;

    if (!silent) setLoading(true);
    else setRefreshing(true);
    let resolvedGp: GoldenPath | null = null;

    try {
      const gpPayload = await fetchJson(
        '/api/brain/golden-paths',
        controller.signal,
      );
      if (!isCurrent()) return;
      if (!isRecord(gpPayload) || !Array.isArray(gpPayload.golden_paths) ||
          !gpPayload.golden_paths.every(isGoldenPath)) {
        throw new Error('invalid golden paths contract');
      }
      resolvedGp = gpPayload.golden_paths.find((candidate) => candidate.id === gpId) || null;

      if (!resolvedGp) {
        setSnapshot({ gp: null, ledgers: [], ledgerUnavailable: false, error: 'GP 不存在或已归档' });
        return;
      }

      if (!resolvedGp.journey_id) {
        setSnapshot({ gp: resolvedGp, ledgers: [], ledgerUnavailable: true, error: null });
        return;
      }

      const journeyId = encodeURIComponent(resolvedGp.journey_id);
      const stepsPayload = await fetchJson(
        `/api/brain/journey_steps?journey_id=${journeyId}`,
        controller.signal,
      );
      if (!isCurrent()) return;
      if (!Array.isArray(stepsPayload) || !stepsPayload.every(isJourneyStep)) {
        throw new Error('invalid journey steps contract');
      }
      const steps = stepsPayload as JourneyStep[];
      const orderedSteps = [...steps].sort((a, b) => a.step_number - b.step_number);
      const ledgerPayloads = await Promise.all(
        orderedSteps.map((step) => fetchJson(
          `/api/brain/journey_steps/${encodeURIComponent(step.id)}/ledger`,
          controller.signal,
        )),
      );
      if (!isCurrent()) return;
      if (!ledgerPayloads.every((payload, index) => isStepLedger(payload, orderedSteps[index]))) {
        throw new Error('invalid step ledger contract');
      }

      setSnapshot({
        gp: resolvedGp,
        ledgers: ledgerPayloads as StepLedger[],
        ledgerUnavailable: false,
        error: null,
      });
    } catch (caughtError) {
      if (!isCurrent() || (caughtError instanceof DOMException && caughtError.name === 'AbortError')) return;
      if (resolvedGp) {
        setSnapshot({ gp: resolvedGp, ledgers: [], ledgerUnavailable: true, error: null });
      } else {
        setSnapshot({ gp: null, ledgers: [], ledgerUnavailable: false, error: 'GP 数据不可用' });
      }
    } finally {
      if (isCurrent()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [gpId]);

  useEffect(() => {
    void loadPage();
    return () => {
      generationRef.current += 1;
      controllerRef.current?.abort();
    };
  }, [loadPage]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div role="status" aria-live="polite" className="flex items-center gap-3 text-slate-400">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">加载 GP 与断言账本…</span>
        </div>
      </div>
    );
  }

  if (error || !gp) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
          <div className="text-sm text-red-400">{error || 'GP 不存在或已归档'}</div>
          <button
            onClick={() => navigate(-1)}
            aria-label="返回战情室"
            className="text-sm text-blue-400 hover:text-blue-300 underline"
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  const displayTitle = gp.title || gp.name || '未命名 GP';
  const journeyId = gp.journey_id || '';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Header */}
      <div className="border-b border-slate-800/60 bg-slate-900/80 backdrop-blur px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={() => navigate(-1)}
          aria-label="返回战情室"
          className="p-1.5 rounded hover:bg-slate-700/50 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <Zap className="w-4 h-4 text-amber-400 flex-shrink-0" />
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span
            data-testid="gp-title"
            className="text-sm font-semibold text-slate-100 truncate"
          >
            {displayTitle}
          </span>
          {gp.status && (
            <span className="text-[11px] text-slate-600 px-1.5 py-0.5 bg-slate-800 rounded font-mono flex-shrink-0">
              {gp.status}
            </span>
          )}
        </div>
        <button
          onClick={() => loadPage(true)}
          aria-label="刷新 GP 与断言账本"
          disabled={refreshing}
          className="p-1.5 rounded hover:bg-slate-700/50 text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Body — 双栏 */}
      <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden">
        <div className="grid grid-cols-1 lg:h-full lg:grid-cols-2">
          {/* 左栏：GP 信息 */}
          <div className="border-r border-slate-800/40 p-4 overflow-y-auto">
            <div className="space-y-4">
              {/* GP 基本信息 */}
              <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <Zap className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-100 leading-snug">{displayTitle}</div>
                    {gp.status && (
                      <div className="mt-1">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400 font-mono">
                          {gp.status}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {gp.one_liner && (
                  <div>
                    <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">One-liner</div>
                    <p className="text-[13px] text-slate-300 leading-relaxed">{gp.one_liner}</p>
                  </div>
                )}

                {gp.description && (
                  <div>
                    <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">描述</div>
                    <p className="text-[12px] text-slate-400 leading-relaxed">{gp.description}</p>
                  </div>
                )}

                <div className="pt-2 border-t border-slate-700/40">
                  <div className="text-[11px] text-slate-600 font-mono">GP ID: {gpId}</div>
                  {journeyId && (
                    <div className="text-[11px] text-slate-600 font-mono mt-0.5">Journey ID: {journeyId}</div>
                  )}
                </div>
              </div>

              {ledgerUnavailable ? (
                <div
                  role="alert"
                  className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200"
                >
                  {journeyId ? '账本数据不可用' : '该 GP 未关联 Journey，账本数据不可用'}
                </div>
              ) : (
                <GoldenPathLedgerPanel ledgers={ledgers} />
              )}
            </div>
          </div>

          {/* 右栏：议题对话（gpId 过滤） */}
          <div className="p-4 flex flex-col overflow-hidden">
            {journeyId ? (
              <ConversationsPanel journeyId={journeyId} gpId={gpId} />
            ) : (
              <div className="flex flex-col items-center justify-center flex-1 gap-3 py-8">
                <div className="text-[12px] text-slate-600 text-center">该 GP 未关联 Journey，无法加载对话</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
