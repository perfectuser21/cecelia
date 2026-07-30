export type VerificationState = 'verified' | 'failed' | 'never_run' | 'not_executable';
export type LedgerZone = 'capability' | 'element' | 'scenario' | 'base_ref';

export interface CellVerification {
  state: VerificationState;
  verified: boolean;
  last_verified: string | null;
  last_run_at: string | null;
  receipt_id: string | null;
  run_id: string | null;
  source_sha: string | null;
  machine_id: string | null;
  assertion_current: boolean;
}

export interface LedgerCell {
  link_id: string;
  cell_kind: LedgerZone;
  cell_key: string;
  cell_status: string;
  assertion_ref: string | null;
  assertion_state: string;
  na_reason: string | null;
  verification: CellVerification;
}

export interface StepLedger {
  step: {
    id: string;
    name: string;
    step_number: number;
    promise?: string | null;
  };
  zones: Record<LedgerZone, LedgerCell[]>;
  coverage: {
    eligible: number;
    verified: number;
    failed: number;
    never_run: number;
    percent: number;
  };
}

interface GoldenPathLedgerPanelProps {
  ledgers: StepLedger[];
}

const zoneLabels: Record<LedgerZone, string> = {
  capability: '能力',
  element: '11 要素',
  scenario: '场景',
  base_ref: '底座引用',
};

const stateMeta: Record<VerificationState, { label: string; className: string }> = {
  verified: {
    label: '已执行验证',
    className: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200',
  },
  failed: {
    label: '最近执行失败',
    className: 'border-red-500/50 bg-red-500/10 text-red-200',
  },
  never_run: {
    label: '仅纸面断言',
    className: 'border-slate-600 bg-slate-800/70 text-slate-300',
  },
  not_executable: {
    label: '不可执行断言',
    className: 'border-slate-700 bg-slate-900/60 text-slate-400',
  },
};

function formatVerifiedAt(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}

function CellCard({ cell, stepName, zone }: {
  cell: LedgerCell;
  stepName: string;
  zone: LedgerZone;
}) {
  const state = cell.verification?.verified ? 'verified' : cell.verification?.state;
  const meta = stateMeta[state] || stateMeta.not_executable;
  const verifiedAt = formatVerifiedAt(cell.verification?.last_verified);
  const semanticReason = cell.na_reason || (
    cell.assertion_state === 'decision' ? '决策断言' :
      cell.assertion_state === 'evaluation' ? '评估断言' :
        cell.assertion_state === 'not_applicable' ? '不适用' : null
  );
  const accessibleName = [
    stepName,
    zoneLabels[zone],
    cell.cell_key,
    `业务状态 ${cell.cell_status}`,
    meta.label,
  ].join('，');

  return (
    <article
      tabIndex={0}
      aria-label={accessibleName}
      data-verification-state={state}
      className={`rounded-md border p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-400 ${meta.className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium break-words">{cell.cell_key}</span>
        <span className="shrink-0 text-[10px]">{meta.label}</span>
      </div>
      <div className="mt-1 text-[10px] opacity-80">业务状态：{cell.cell_status}</div>
      {semanticReason && <div className="mt-1 text-[10px] opacity-80">{semanticReason}</div>}
      {verifiedAt && <div className="mt-1 text-[10px] opacity-80">最近验证：{verifiedAt}</div>}
      {(cell.verification?.source_sha || cell.verification?.machine_id) && (
        <div className="mt-1 break-all text-[10px] opacity-70">
          {cell.verification.source_sha?.slice(0, 12)}
          {cell.verification.source_sha && cell.verification.machine_id ? ' · ' : ''}
          {cell.verification.machine_id}
        </div>
      )}
    </article>
  );
}

export default function GoldenPathLedgerPanel({ ledgers }: GoldenPathLedgerPanelProps) {
  if (ledgers.length === 0) {
    return <div className="text-xs text-slate-500">该 Journey 没有账本步骤</div>;
  }

  return (
    <section aria-label="Golden Path 断言验证账本" className="space-y-4">
      {ledgers.map((ledger) => (
        <article
          key={ledger.step.id}
          aria-labelledby={`ledger-step-${ledger.step.id}`}
          className="rounded-lg border border-slate-700/60 bg-slate-800/30 p-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 id={`ledger-step-${ledger.step.id}`} className="text-sm font-semibold text-slate-100">
                {ledger.step.step_number}. {ledger.step.name}
              </h2>
              {ledger.step.promise && (
                <p className="mt-1 text-[11px] text-slate-400">{ledger.step.promise}</p>
              )}
            </div>
            <div
              aria-label={`验证覆盖率 ${ledger.coverage.percent}%`}
              className="shrink-0 rounded bg-slate-900/70 px-2 py-1 text-xs text-slate-200"
            >
              覆盖率 {ledger.coverage.percent}%
            </div>
          </div>
          <p className="mt-2 text-[10px] text-slate-500">
            可执行 {ledger.coverage.eligible} · 已验证 {ledger.coverage.verified} ·
            失败 {ledger.coverage.failed} · 未运行 {ledger.coverage.never_run}
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
            {(Object.keys(zoneLabels) as LedgerZone[]).map((zone) => (
              <section key={zone} aria-label={zoneLabels[zone]} className="min-w-0 space-y-2">
                <h3 className="text-[11px] font-medium text-slate-400">{zoneLabels[zone]}</h3>
                {(ledger.zones[zone] || []).length === 0 ? (
                  <div className="rounded border border-dashed border-slate-800 p-2 text-[10px] text-slate-600">
                    暂无格子
                  </div>
                ) : (
                  ledger.zones[zone].map((cell) => (
                    <CellCard key={cell.link_id} cell={cell} stepName={ledger.step.name} zone={zone} />
                  ))
                )}
              </section>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}
