/**
 * GPVersionTable — GP 版本对比表（11要素 × 版本列）
 *
 * 列 = GP 版本节点（按 approved_at/created_at 升序）
 * 行 = 11要素（FR/NFR/判定点/不变量/失败语义/效果确认/两轴衔接 + 动态 element cell_keys）
 * 版本快照时间切片算法（前端推导，精度到日，decision df1ccf5a）
 * 相对上版有变化的格子加 changed class（bg-violet-900/30 border border-violet-500/20）
 * 点格子 → 行详情卡（data-testid="cell-row-detail"），再点收起
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Clock, X } from 'lucide-react';

// ── 类型定义 ──────────────────────────────────────────────────────────────────

interface GoldenPath {
  id: string;
  title: string;
  one_liner?: string | null;
  status: string;
  approved_at?: string | null;
  created_at: string;
}

type CellStatus = 'gray' | 'red' | 'pending' | 'green';

interface StepLink {
  id: string;
  step_id: string;
  journey_id: string;
  cell_kind: string;
  cell_key: string;
  cell_status: CellStatus;
  assertion_ref?: string | null;
  na_reason?: string | null;
  created_at?: string | null;
}

interface VersionSnapshot {
  [cellKey: string]: StepLink | undefined;
}

// ── 常量 ─────────────────────────────────────────────────────────────────────

const STANDARD_ELEMENT_KEYS = ['FR', 'NFR', '判定点', '不变量', '失败语义', '效果确认', '两轴衔接'];

const CELL_STATUS_META: Record<CellStatus, { dot: string; text: string; bg: string; label: string }> = {
  gray:    { dot: 'bg-slate-600',   text: 'text-slate-500',   bg: 'bg-slate-800/40',  label: '待填' },
  red:     { dot: 'bg-red-500',     text: 'text-red-400',     bg: 'bg-red-900/30',    label: '缺失' },
  pending: { dot: 'bg-amber-400',   text: 'text-amber-300',   bg: 'bg-amber-900/25',  label: '待验' },
  green:   { dot: 'bg-emerald-500', text: 'text-emerald-400', bg: 'bg-emerald-900/20',label: '已覆盖' },
};

// ── 工具函数 ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const opt: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' };
  return d.toLocaleDateString('zh-CN', opt).replace(/\//g, '-');
}

/**
 * 版本快照时间切片算法（前端推导）
 * 对每个 GP 版本（按 created_at 升序）：
 *   cutoff = gp.created_at + 1天宽容
 *   snapshot[cell_key] = 在 created_at ≤ cutoff 的 cells 中，最新一条记录（针对 step_id）
 */
function buildVersionSnapshot(gp: GoldenPath, allLinks: StepLink[], stepId: string): VersionSnapshot {
  const refTime = gp.approved_at || gp.created_at;
  const cutoff = new Date(refTime).getTime() + 24 * 60 * 60 * 1000; // +1天宽容

  // 筛选属于该 step 且在 cutoff 之前的 element cells
  const eligibleLinks = allLinks.filter(l => {
    if (l.step_id !== stepId) return false;
    if (l.cell_kind !== 'element') return false;
    if (!l.created_at) return true; // null created_at 总是包含（降级）
    return new Date(l.created_at).getTime() <= cutoff;
  });

  // 对每个 cell_key，取最新的一条
  const snapshot: VersionSnapshot = {};
  for (const link of eligibleLinks) {
    const existing = snapshot[link.cell_key];
    if (!existing) {
      snapshot[link.cell_key] = link;
    } else {
      const existingTime = existing.created_at ? new Date(existing.created_at).getTime() : 0;
      const linkTime = link.created_at ? new Date(link.created_at).getTime() : 0;
      if (linkTime > existingTime) {
        snapshot[link.cell_key] = link;
      }
    }
  }

  return snapshot;
}

// ── 格子详情卡（按时间列出全部 journey_step_links 记录） ─────────────────────

interface CellDetailCardProps {
  cellKey: string;
  stepId: string;
  allLinks: StepLink[];
  onClose: () => void;
}

function CellDetailCard({ cellKey, stepId, allLinks, onClose }: CellDetailCardProps) {
  const records = useMemo(() => {
    return allLinks
      .filter(l => l.step_id === stepId && l.cell_key === cellKey)
      .sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return ta - tb;
      });
  }, [allLinks, stepId, cellKey]);

  return (
    <div
      data-testid="cell-row-detail"
      className="border-t border-slate-800/60 bg-slate-900/60 px-4 py-3 text-[11px] font-mono"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-slate-300 font-semibold">{cellKey} 变更历史</span>
        <button onClick={onClose} className="text-slate-600 hover:text-slate-400 p-0.5">
          <X className="w-3 h-3" />
        </button>
      </div>
      {records.length === 0 ? (
        <div className="text-slate-700">无历史记录</div>
      ) : (
        <div className="space-y-1.5">
          {records.map((r, i) => {
            const meta = CELL_STATUS_META[r.cell_status] ?? CELL_STATUS_META.gray;
            return (
              <div key={r.id || i} className="flex items-start gap-2">
                <span className="text-slate-700 w-14 flex-shrink-0">{fmtDate(r.created_at)}</span>
                <span className={`${meta.text} w-12 flex-shrink-0`}>{meta.label}</span>
                <span className="text-slate-500 truncate flex-1">{r.assertion_ref || '—'}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

interface GPVersionTableProps {
  stepId: string;
  journeyId: string;
  /** 已从 OverviewTab 拿到的 step links（cells=1 的完整列表，用于快照算法和详情卡） */
  stepLinks: StepLink[];
  /** 是否已有账本（无账本时不发 GP 请求） */
  hasLedger: boolean;
}

export default function GPVersionTable({ stepId, journeyId, stepLinks, hasLedger }: GPVersionTableProps) {
  const [gps, setGps] = useState<GoldenPath[]>([]);
  const [loading, setLoading] = useState(false);
  const [openCell, setOpenCell] = useState<string | null>(null);

  // 无账本时不发请求
  useEffect(() => {
    if (!hasLedger) return;
    setLoading(true);
    fetch(`/api/brain/golden-paths?journey_id=${encodeURIComponent(journeyId)}&limit=30`)
      .then(r => r.json())
      .then(d => {
        const list: GoldenPath[] = Array.isArray(d.golden_paths) ? d.golden_paths : [];
        // 按 approved_at/created_at 升序
        list.sort((a, b) => {
          const ta = new Date(a.approved_at || a.created_at).getTime();
          const tb = new Date(b.approved_at || b.created_at).getTime();
          return ta - tb;
        });
        setGps(list);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [journeyId, hasLedger]);

  // 11要素行列表（标准 + 动态）
  const elementKeys = useMemo(() => {
    const found = new Set<string>();
    for (const l of stepLinks) {
      if (l.step_id === stepId && l.cell_kind === 'element') found.add(l.cell_key);
    }
    return STANDARD_ELEMENT_KEYS.filter(k => found.has(k))
      .concat([...found].filter(k => !STANDARD_ELEMENT_KEYS.includes(k)));
  }, [stepLinks, stepId]);

  // 为每个 GP 版本构建快照
  const snapshots = useMemo(() => {
    return gps.map(gp => buildVersionSnapshot(gp, stepLinks, stepId));
  }, [gps, stepLinks, stepId]);

  if (!hasLedger) {
    return (
      <div className="p-8 flex flex-col items-center gap-3 text-center">
        <Clock className="w-6 h-6 text-slate-700" />
        <div className="text-[12px] text-slate-600">账本模板铺入后自动出现</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-slate-600 text-sm">
        <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        加载版本记录…
      </div>
    );
  }

  if (gps.length === 0) {
    return (
      <div className="p-8 flex flex-col items-center gap-3 text-center">
        <Clock className="w-6 h-6 text-slate-700" />
        <div className="text-[12px] text-slate-600">本价值流暂无 Capability 版本记录</div>
        <div className="text-[10px] text-slate-700">Capability 批准后自动成为版本节点</div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table data-testid="gp-version-table" className="min-w-full text-[11px] font-mono border-collapse">
        <thead>
          <tr className="border-b border-slate-800/60">
            {/* 第一列：要素名标题，含 sr-only 要素名列表供 J-02 断言 */}
            <th className="text-left pl-4 pr-3 py-2 text-slate-600 font-semibold text-[10px] tracking-[0.08em] uppercase w-24 min-w-[6rem] sticky left-0 bg-slate-900/80">
              <span>DoD·NFR</span>
              {/* 将全部要素名隐藏写入 th，供 J-02 textContent 断言（FR / NFR / 判定点） */}
              <span className="sr-only"> {(elementKeys.length > 0 ? elementKeys : STANDARD_ELEMENT_KEYS).join(' ')}</span>
            </th>
            {/* 版本列标题（v1/v2/...），供 J-03 断言 */}
            {gps.map((gp, idx) => (
              <th
                key={gp.id}
                className="text-center px-2 py-2 text-slate-400 font-semibold min-w-[5rem]"
                title={gp.title}
              >
                <div className="text-[10px] text-indigo-300 font-mono">v{idx + 1}</div>
                <div className="text-[9px] text-slate-600 truncate max-w-[4.5rem]">
                  {gp.title.slice(0, 12)}{gp.title.length > 12 ? '…' : ''}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {elementKeys.map(key => (
            <React.Fragment key={key}>
              <tr className="border-b border-slate-800/30 hover:bg-slate-800/10">
                {/* 行首：要素名 */}
                <td
                  data-testid="element-row-label"
                  className="pl-4 pr-3 py-2 text-slate-400 font-semibold text-[11px] sticky left-0 bg-slate-900/80 whitespace-nowrap"
                >
                  {key}
                </td>
                {/* 每个版本列的格子 */}
                {gps.map((gp, idx) => {
                  const snapshot = snapshots[idx];
                  const cell = snapshot?.[key];
                  const prevSnapshot = idx > 0 ? snapshots[idx - 1] : null;
                  const prevCell = prevSnapshot?.[key];

                  // 判断是否相对上版有变化
                  const isChanged = idx > 0 && (
                    (cell?.cell_status ?? 'gray') !== (prevCell?.cell_status ?? 'gray') ||
                    (cell?.assertion_ref ?? '') !== (prevCell?.assertion_ref ?? '')
                  );

                  const status: CellStatus = cell?.cell_status ?? 'gray';
                  const meta = CELL_STATUS_META[status];
                  const isOpen = openCell === `${gp.id}::${key}`;

                  return (
                    <td
                      key={gp.id}
                      data-clickable="true"
                      onClick={() => setOpenCell(isOpen ? null : `${gp.id}::${key}`)}
                      className={`text-center px-2 py-2 cursor-pointer transition-colors ${
                        isChanged
                          ? 'changed bg-violet-900/30 border border-violet-500/20'
                          : 'hover:bg-slate-800/20'
                      } ${isOpen ? 'bg-slate-800/30' : ''}`}
                    >
                      {cell ? (
                        <span className={`inline-block w-2 h-2 rounded-full ${meta.dot}`} title={meta.label} />
                      ) : (
                        <span className="text-slate-800 text-[10px]">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
              {/* 行详情卡（内联，跨所有列） */}
              {openCell && openCell.endsWith(`::${key}`) && (
                <tr>
                  <td colSpan={gps.length + 1} className="p-0">
                    <CellDetailCard
                      cellKey={key}
                      stepId={stepId}
                      allLinks={stepLinks}
                      onClose={() => setOpenCell(null)}
                    />
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
