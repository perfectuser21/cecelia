/**
 * lifecycle.ts — Harness Pipeline Cockpit Phase 2 纯逻辑模块（read-only 全生命周期视图）
 *
 * 七项全生命周期分区定义 + 占位选择。无 React / 无 DOM / 无 fetch，
 * 故可在 node env（packages/brain vitest）与 happy-dom（apps/dashboard vitest）双环境运行。
 *
 * ── id 解析约定（Risk (a) mitigation）──────────────────────────────────────
 * route `:id` == harness_initiative task 自身 id。wiring 层用同一个 id 直接请求
 *   GET /api/brain/tasks/:id
 *   GET /api/brain/harness/initiative/:id/detail
 *   GET /api/brain/harness/runs/:id/progress
 * （与 final-e2e oracle 的注入口径一致：脚本同样用 PIPELINE_ID 直打这三个端点）。
 * 任一端点取数失败 → wiring 在 errors[key]=true → 该分区显示 FETCH_FAILED（取数失败），
 * 绝不伪装成 NOT_REACHED（未到该步），让接线错误「可见」。
 *
 * ── 占位语义（Risk (b) mitigation：两类占位字面分离）────────────────────────
 *   NOT_REACHED  = '未到该步'  取数成功但该项尚未产出 / 字段为 null（正常生命周期态）
 *   FETCH_FAILED = '取数失败'  端点取数失败（网络/404/500），潜在接线错误信号
 *   NO_DECISIONS = '暂无决策'  decisions 查询成功但无匹配行
 * 三者字面互不相等；占位绝不为旧的裸缺失死字。
 *
 * ── DoD/Report 反偷源（Risk (c) mitigation）────────────────────────────────
 * selectSectionContent 是纯映射（key → 其「专属」source 字段），内部绝不从 contractContent
 * 正则切段冒充 DoD/Report。Brain 暂无独立 dod_content/report_content 字段 → wiring 显式传 null
 * → 显示「未到该步」，而非从 contract 偷内容。
 */

export const NOT_REACHED = '未到该步';
export const FETCH_FAILED = '取数失败';
export const NO_DECISIONS = '暂无决策';

export type LifecycleKey =
  | 'prep_prd'
  | 'sprint_prd'
  | 'contract'
  | 'dod'
  | 'decisions'
  | 'progress'
  | 'report';

export interface LifecycleSection {
  key: LifecycleKey;
  label: string;
}

/** 七项分区按生命周期顺序（顺序为合同 SSOT，CI lifecycle-contract.test.ts 锁定）。 */
export const LIFECYCLE_SECTIONS: LifecycleSection[] = [
  { key: 'prep_prd', label: 'PrepPRD' },
  { key: 'sprint_prd', label: '正式 PRD' },
  { key: 'contract', label: 'Contract' },
  { key: 'dod', label: 'DoD' },
  { key: 'decisions', label: '决策清单' },
  { key: 'progress', label: '流水线留痕' },
  { key: 'report', label: 'Report' },
];

export interface DecisionRow {
  id?: string;
  decision?: string;
  target?: string;
  status?: string;
  rationale?: string;
  [k: string]: unknown;
}

export interface ProgressInfo {
  pct?: number | null;
  current_node?: string | null;
  phase?: string | null;
  [k: string]: unknown;
}

/**
 * 七项分区各自的「专属」source 字段（wiring 层从 Brain 端点显式赋值）。
 * 每个字段只喂给其对应分区——这正是 Risk (c) 反偷源的纯映射保证。
 */
export interface LifecycleSources {
  prepPrdBody?: string | null;
  prdContent?: string | null;
  contractContent?: string | null;
  dodContent?: string | null;
  reportContent?: string | null;
  decisions?: DecisionRow[] | null;
  progress?: ProgressInfo | null;
  /** 各 key 端点取数失败标记（Risk a/b：失败 ≠ 未到该步）。 */
  errors?: Partial<Record<LifecycleKey, boolean>>;
}

export type SectionContent =
  | { kind: 'markdown'; body: string }
  | { kind: 'placeholder'; text: string };

function markdown(body: string): SectionContent {
  return { kind: 'markdown', body };
}

function placeholder(text: string): SectionContent {
  return { kind: 'placeholder', text };
}

/** 把决策行渲染成 Markdown 列表（read-only 展示，不做任何写操作）。 */
function renderDecisions(rows: DecisionRow[]): string {
  return rows
    .map((d) => {
      const head = d.decision ?? d.id ?? '(未命名决策)';
      const meta = [
        d.target ? `target: ${d.target}` : null,
        d.status ? `状态: ${d.status}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return meta ? `- ${head}\n  - ${meta}` : `- ${head}`;
    })
    .join('\n');
}

/** 把进度对象渲染成 Markdown 摘要。 */
function renderProgress(p: ProgressInfo): string {
  const pct = typeof p.pct === 'number' ? `${p.pct}%` : '—';
  const node = p.current_node ?? '—';
  const phase = p.phase ?? '—';
  return `**进度**: ${pct}\n\n- 当前节点: ${node}\n- 阶段: ${phase}`;
}

/**
 * 纯映射：key → 其专属 source 字段 → SectionContent。
 *
 * 取数失败（errors[key]）优先于内容判断——失败必须显示「取数失败」，不可被内容掩盖，
 * 也绝不退化成「未到该步」（Risk a/b）。各 key 只读自己的专属字段，绝不跨字段偷取（Risk c）。
 */
export function selectSectionContent(
  key: LifecycleKey | string,
  sources: LifecycleSources = {},
): SectionContent {
  // Risk (a)/(b)：取数失败优先，绝不伪装成「未到该步」
  if (sources.errors && sources.errors[key as LifecycleKey]) {
    return placeholder(FETCH_FAILED);
  }

  switch (key) {
    case 'prep_prd':
      return sources.prepPrdBody ? markdown(sources.prepPrdBody) : placeholder(NOT_REACHED);

    case 'sprint_prd':
      return sources.prdContent ? markdown(sources.prdContent) : placeholder(NOT_REACHED);

    case 'contract':
      return sources.contractContent ? markdown(sources.contractContent) : placeholder(NOT_REACHED);

    case 'dod':
      // Risk (c)：只认专属 dodContent，绝不从 contractContent 切段冒充
      return sources.dodContent ? markdown(sources.dodContent) : placeholder(NOT_REACHED);

    case 'decisions': {
      const rows = sources.decisions;
      if (rows === undefined || rows === null) return placeholder(NOT_REACHED);
      if (rows.length === 0) return placeholder(NO_DECISIONS);
      return markdown(renderDecisions(rows));
    }

    case 'progress':
      return sources.progress ? markdown(renderProgress(sources.progress)) : placeholder(NOT_REACHED);

    case 'report':
      // Risk (c)：只认专属 reportContent，绝不从 contractContent / result 猜
      return sources.reportContent ? markdown(sources.reportContent) : placeholder(NOT_REACHED);

    default:
      return placeholder(NOT_REACHED);
  }
}
