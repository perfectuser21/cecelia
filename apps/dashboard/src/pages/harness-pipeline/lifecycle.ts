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
 * 正则切段冒充 DoD/Report。DoD 仍无独立字段 → wiring 显式传 null → 显示「未到该步」。
 * Report 则有专属数据源：tasks.result.report_content（Sprint 产物契约，见
 *   packages/brain/src/sprint-result-contract.js），经 detail 端点透出。wiring 用
 *   renderReportContract() 把契约对象渲染成 Markdown 喂给 reportContent，绝不从 contract 偷内容。
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

/** 单个节点遥测（Sprint 产物契约 node_telemetry 元素）。 */
export interface NodeTelemetry {
  node?: string | null;
  start_ts?: string | null;
  end_ts?: string | null;
  tokens?: number | null;
  cost?: number | null;
}

/**
 * Sprint 产物契约（部分字段；与 packages/brain/src/sprint-result-contract.js 对齐）。
 * read-only 展示只取需要的字段，缺字段一律安全降级，永不抛。
 */
export interface SprintResultContract {
  verdict?: string | null;
  change_summary?: string | null;
  next_action?: string | null;
  total_cost?: number | null;
  failed_scenarios?: unknown[];
  incidental_bugs?: unknown[];
  improvement_items?: unknown[];
  linked_issues?: unknown[];
  open_issues_with_learnings?: unknown[];
  node_telemetry?: NodeTelemetry[];
  [k: string]: unknown;
}

/** 把字符串数组渲染成 Markdown 无序列表；空则返回「无」。 */
function renderList(items: unknown): string {
  const arr = Array.isArray(items) ? items : [];
  if (arr.length === 0) return '无';
  return arr.map((x) => `- ${String(x)}`).join('\n');
}

/** node_telemetry → Markdown 表格（节点 / 起 / 止 / tokens / cost）。空则返回「无遥测数据」。 */
function renderTelemetryTable(rows: NodeTelemetry[] | undefined): string {
  const arr = Array.isArray(rows) ? rows : [];
  if (arr.length === 0) return '无遥测数据';
  const head = '| 节点 | 开始 | 结束 | tokens | cost |\n| --- | --- | --- | --- | --- |';
  const body = arr
    .map((r) => {
      const node = r?.node ?? '—';
      const start = r?.start_ts ?? '—';
      const end = r?.end_ts ?? '—';
      const tokens = r?.tokens != null ? String(r.tokens) : '—';
      const cost = r?.cost != null ? `$${r.cost}` : '—';
      return `| ${node} | ${start} | ${end} | ${tokens} | ${cost} |`;
    })
    .join('\n');
  return `${head}\n${body}`;
}

/**
 * 把 Sprint 产物契约对象渲染成 Report tab 的 Markdown。
 * 纯函数，缺字段安全降级，永不抛。非对象输入 → null（上层走 NOT_REACHED 占位）。
 *
 * 渲染：verdict / 变更摘要 / 下一步 / 总花费 / 失败场景 / node_telemetry 表 / 发现四类。
 */
export function renderReportContract(c: unknown): string | null {
  if (!c || typeof c !== 'object') return null;
  const r = c as SprintResultContract;

  const verdict = r.verdict ?? '—';
  const changeSummary = r.change_summary ?? '—';
  const nextAction = r.next_action ?? '—';
  const totalCost = typeof r.total_cost === 'number' ? `$${r.total_cost}` : '—';

  const sections = [
    `## Sprint 产物报告`,
    ``,
    `**裁决（verdict）**: ${verdict}`,
    ``,
    `**总花费**: ${totalCost}`,
    ``,
    `### 变更摘要`,
    changeSummary,
    ``,
    `### 下一步`,
    nextAction,
    ``,
    `### 失败场景`,
    renderList(r.failed_scenarios),
    ``,
    `### 节点遥测`,
    renderTelemetryTable(r.node_telemetry),
    ``,
    `### 发现`,
    `**路上撞见的 bug（incidental_bugs）**`,
    renderList(r.incidental_bugs),
    ``,
    `**改进项（improvement_items）**`,
    renderList(r.improvement_items),
    ``,
    `**关联 Issue（linked_issues）**`,
    renderList(r.linked_issues),
    ``,
    `**未解决 Issue + 累积 learning（open_issues_with_learnings）**`,
    renderList(r.open_issues_with_learnings),
  ];

  return sections.join('\n');
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
