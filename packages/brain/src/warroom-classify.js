/**
 * warroom-classify.js — 战情室任务分类纯函数
 *
 * 把"跑起来的任务"分类到 Area → Group 两级，用于战情室 feed 分组。
 * 全部纯函数，无 DB / 无副作用，便于单测。
 *
 * 分组依据优先级：
 *   Area：payload.base_repo（最可靠，~98% harness 任务有）
 *   Group：journey 名（有 journey_id 时）> 关键词推断子系统（Cecelia 无 journey 时）
 */

/** kebab-case slug，用作 area/group 的稳定 key */
export function slug(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

/**
 * 一级分类：Area（产品域）
 * @param {object} task  含 payload.base_repo
 * @returns {{areaKey:string, areaName:string, order:number}}
 */
export function classifyArea(task) {
  const repo = String(task?.payload?.base_repo || '').toLowerCase();
  if (repo.includes('zenithjoy')) return { areaKey: 'zenithjoy', areaName: 'ZenithJoy', order: 1 };
  if (repo.includes('infrastructure')) return { areaKey: 'infra', areaName: 'Infrastructure', order: 2 };
  // cecelia repo / 本地 dev 任务（无 repo）/ 其他 → Cecelia
  return { areaKey: 'cecelia', areaName: 'Cecelia', order: 0 };
}

/**
 * 二级分类：Group（线 / 子系统）
 * @param {object} task         含 title / description / payload.sprint_dir
 * @param {{areaKey:string}} area
 * @param {string|null} journeyName  task.payload.journey_id 查到的 journey 名
 * @returns {{groupKey:string, groupName:string}}
 */
export function classifyGroup(task, area, journeyName) {
  // 有 journey 名 → 直接作为 group（ZenithJoy 的 Line、Cecelia 的 MJ 闭环都走这里）
  if (journeyName && journeyName.trim()) {
    return { groupKey: slug(journeyName), groupName: journeyName.trim() };
  }

  const text = [
    task?.title || '',
    task?.payload?.sprint_dir || '',
    task?.description || '',
  ].join(' ').toLowerCase();

  if (area.areaKey === 'cecelia') {
    if (/dashboard|apps\/dashboard|前端|可视化|warroom|战情/.test(text)) return { groupKey: 'dashboard', groupName: 'Dashboard' };
    if (/engine|packages\/engine|hook|skill|devgate|registry/.test(text)) return { groupKey: 'engine', groupName: 'Engine' };
    if (/\binfra\b|deploy|部署|docker|pm2|\bci\b/.test(text)) return { groupKey: 'infra', groupName: 'Infra' };
    // 默认归 Brain API（Cecelia 任务绝大多数是 Brain 端）
    return { groupKey: 'brain', groupName: 'Brain API' };
  }

  return { groupKey: 'uncategorized', groupName: '未分类' };
}

// ───────────────────────── Line 中心化（PR-A 纯函数）─────────────────────────

// journey 名字 → ZenithJoy 的关键词（对齐 CLAUDE.md Line 映射 + spec §归类）
const ZENITHJOY_NAME_RE = /智能发布|视频剪辑|运营中枢|客户|获客|私域|发布|剪辑|Line\s*0/i;

/**
 * 按 journey 名字把它归到一个 Area（纯函数，对齐 spec §journey→area 归类）。
 * @param {string} name  journey.name
 * @returns {'zenithjoy'|'cecelia'}
 */
// biz_area 合法三桶（journeys.biz_area，migration 389；Alex 08-05 拍板：分区不许靠名字猜）
const BIZ_AREAS = new Set(['cecelia', 'zenithjoy', 'infrastructure']);

export function classifyJourneyArea(name, bizArea) {
  // 一等字段优先：库里登记过归属就用登记值
  if (bizArea && BIZ_AREAS.has(String(bizArea))) return String(bizArea);
  // 存量兜底：名字正则（仅未回填的旧行走到这里）
  const n = String(name || '');
  if (ZENITHJOY_NAME_RE.test(n)) return 'zenithjoy';
  return 'cecelia';
}

// step.status 视为"已完成"的取值集合
const STEP_DONE_STATUSES = new Set(['done', 'completed']);

/**
 * 统计一条线的 roadmap 进度（纯函数）。
 * @param {Array<{status:string}>} steps  journey_steps 行
 * @returns {{step_total:number, step_done:number}}
 */
export function computeStepProgress(steps) {
  const arr = Array.isArray(steps) ? steps : [];
  let step_done = 0;
  for (const s of arr) {
    if (STEP_DONE_STATUSES.has(String(s?.status || '').toLowerCase())) step_done++;
  }
  return { step_total: arr.length, step_done };
}

/**
 * 一条 journey 用于匹配 task.payload.journey_id 的所有键（id + notion_id 双格式）。
 * @param {{id?:string, notion_id?:string}} journey
 * @returns {string[]}
 */
export function journeyIdKeys(journey) {
  const keys = [];
  if (journey?.id) keys.push(String(journey.id));
  if (journey?.notion_id) keys.push(String(journey.notion_id));
  return keys;
}

/**
 * 判断 task 是否关联到给定 journey（payload.journey_id 命中 id 或 notion_id）。
 * @param {{payload?:{journey_id?:string}}} task
 * @param {{id?:string, notion_id?:string}} journey
 * @returns {boolean}
 */
export function taskMatchesJourney(task, journey) {
  const jid = task?.payload?.journey_id;
  if (jid == null) return false;
  return journeyIdKeys(journey).includes(String(jid));
}

/**
 * 任务种类 → 用于前端标签 + 决定下钻详情页
 * @param {string} taskType
 * @returns {'sprint'|'pipeline'|'scraper'|'task'}
 */
export function classifyKind(taskType) {
  switch (taskType) {
    case 'harness_initiative': return 'sprint';
    case 'content-pipeline':   return 'pipeline';
    case 'platform_scraper':   return 'scraper';
    default:                   return 'task';
  }
}

/**
 * 下钻路由（L2 详情页）
 * sprint → /pipeline/:id（HarnessPipelineDetailPage，有阶段时间线）
 * 其他   → /tasks/:id/prd（通用任务详情）
 */
export function detailRoute(task, kind) {
  if (kind === 'sprint') return `/pipeline/${task.id}`;
  return `/tasks/${task.id}/prd`;
}

/**
 * 状态归一：把各种 task.status 收敛为战情室 4 态
 * @returns {'active'|'done'|'failed'|'canceled'}
 */
export function normStatus(status) {
  switch (status) {
    case 'in_progress':
    case 'queued':
    case 'claimed':
      return 'active';
    case 'completed':
      return 'done';
    case 'failed':
    case 'blocked':
      return 'failed';
    case 'canceled':
    case 'cancelled':
      return 'canceled';
    default:
      return 'active';
  }
}

/** ts → Asia/Shanghai 的 YYYY-MM-DD（用于今日/本月判断） */
export function shanghaiDay(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  } catch {
    return '';
  }
}

// harness-pipelines stage.status → 战情室 4 态（done/running/pending/failed）
const STAGE_STATUS_MAP = {
  completed: 'done',
  in_progress: 'running',
  running: 'running',
  not_started: 'pending',
  pending: 'pending',
  queued: 'pending',
  failed: 'failed',
};

/**
 * 把 /api/brain/harness-pipelines 的一条 pipeline 记录归一成 feed 用的 lg 契约（纯函数）。
 *
 * - stages：`{task_type,label,status}` → `{key,label,status,elapsed_ms}`，status 收敛为 4 态。
 *   harness-pipelines 当前 stage 不带 elapsed，统一给 null（前端按缺省处理）。
 * - ws_verdicts：langgraph 里 workstreams `["ws1"]` + ws_verdicts `["queued"]` 两个平行数组，
 *   拉链成 `[{name,verdict}]`。空 → null。
 * - 空 stages → null（非 sprint / 老 pipeline）。
 *
 * @param {object} rec  harness-pipelines.pipelines[] 单条记录
 * @returns {object} 归一后的 lg 契约
 */
export function normalizeLg(rec) {
  const g = (rec && rec.langgraph) || {};

  const rawStages = Array.isArray(rec?.stages) ? rec.stages : [];
  const stages = rawStages.length > 0
    ? rawStages.map((s) => ({
        key: s.task_type || s.key || 'unknown',
        label: s.label || s.task_type || 'unknown',
        status: STAGE_STATUS_MAP[s.status] || 'pending',
        elapsed_ms: typeof s.elapsed_ms === 'number' ? s.elapsed_ms : null,
      }))
    : null;

  const wsNames = Array.isArray(g.workstreams) ? g.workstreams : [];
  const wsRaw = Array.isArray(g.ws_verdicts) ? g.ws_verdicts : [];
  let ws_verdicts = null;
  if (wsRaw.length > 0) {
    ws_verdicts = wsRaw.map((v, i) => {
      // 已是 {name,verdict} 对象则透传；否则与 workstreams 拉链
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return { name: v.name ?? wsNames[i] ?? `ws${i + 1}`, verdict: v.verdict ?? '' };
      }
      return { name: wsNames[i] ?? `ws${i + 1}`, verdict: v == null ? '' : String(v) };
    });
  }

  const num = (x) => (typeof x === 'number' ? x : null);

  return {
    node_label: g.current_node_label ?? null,
    current_node: g.current_node ?? null,
    gan_rounds: num(g.gan_rounds),
    fix_rounds: num(g.fix_rounds),
    review_round: num(g.review_round),
    eval_round: num(g.eval_round),
    last_error: g.last_error ?? null,
    pr_urls: Array.isArray(g.pr_urls) ? g.pr_urls : null,
    ws_verdicts,
    stages,
    elapsed_ms: num(rec?.elapsed_ms),
  };
}

/**
 * 把一行 task 组装成战情室 feed item（纯函数）
 * @param {object} t            task row
 * @param {string|null} journeyName
 * @param {{pct:number, node:string}|null} progress
 * @param {number} nowMs
 * @param {{verdict?:string, pr_url?:string, findings_count?:number}|null} report
 *        对应 sprint 的 harness_report 摘要（按 initiative_id 关联）。
 *        harness_report 不单独成行，其 verdict/pr/findings 合并进所属 sprint。
 * @param {object|null} lg
 *        normalizeLg 产出的 LangGraph 富数据（仅 sprint 命中 harness-pipelines 时有）。
 *        非 sprint 任务一律忽略 lg，契约字段全部 null。
 *        lg 命中时用其 current_node/elapsed_ms 覆盖 initiative_run_events 拼的较弱值。
 */
export function toFeedItem(t, journeyName, progress, nowMs, report = null, lg = null) {
  const area = classifyArea(t);
  const group = classifyGroup(t, area, journeyName);
  const kind = classifyKind(t.task_type);
  const status = normStatus(t.status);

  let elapsed_ms = null;
  if (t.started_at) {
    const start = new Date(t.started_at).getTime();
    if (t.completed_at) elapsed_ms = new Date(t.completed_at).getTime() - start;
    else if (status === 'active') elapsed_ms = nowMs - start;
  }

  // pr_url 优先级：task 自身 > task.result > report 兜底
  const pr_url = t.pr_url || (t.result && t.result.pr_url) || (report && report.pr_url) || null;

  // LangGraph 富数据仅对 sprint 生效；其余任务该批字段全 null（契约要求）。
  const useLg = kind === 'sprint' && lg ? lg : null;

  // current_node / elapsed_ms：lg 命中时用 lg 覆盖（更准），否则回退原逻辑。
  let current_node = progress ? progress.node : null;
  if (useLg && useLg.current_node != null) current_node = useLg.current_node;
  if (useLg && typeof useLg.elapsed_ms === 'number') elapsed_ms = useLg.elapsed_ms;

  return {
    id: t.id,
    kind,
    title: t.title || '(untitled)',
    status,
    raw_status: t.status,
    priority: t.priority || null,
    created_at: t.created_at,
    elapsed_ms,
    progress_pct: progress ? progress.pct : null,
    current_node,
    fail_reason: status === 'failed' ? (t.error_message || null) : null,
    pr_url,
    verdict: report ? (report.verdict || null) : null,
    findings_count: report ? (report.findings_count ?? null) : null,
    routing: t.routing ?? null,
    detail_route: detailRoute(t, kind),
    // —— LangGraph 富字段（仅 sprint，join harness-pipelines）——
    node_label: useLg ? (useLg.node_label ?? null) : null,
    gan_rounds: useLg ? (useLg.gan_rounds ?? null) : null,
    fix_rounds: useLg ? (useLg.fix_rounds ?? null) : null,
    review_round: useLg ? (useLg.review_round ?? null) : null,
    eval_round: useLg ? (useLg.eval_round ?? null) : null,
    stages: useLg ? (useLg.stages ?? null) : null,
    ws_verdicts: useLg ? (useLg.ws_verdicts ?? null) : null,
    last_error: useLg ? (useLg.last_error ?? null) : null,
    pr_urls: useLg ? (useLg.pr_urls ?? null) : null,
    _area: area,
    _group: group,
  };
}

/**
 * 聚合任务 → Area → Group 树（纯函数）
 * @param {object[]} tasks
 * @param {Record<string,string>} journeyNameById  journey_id → name（notion_id 或 uuid）
 * @param {Record<string,{pct:number,node:string}>} progressById  task.id → progress
 * @param {number} nowMs
 * @param {Record<string,{verdict?:string,pr_url?:string,findings_count?:number}>} reportByInitiativeId
 *        sprint task.id → 该 sprint 的 harness_report 摘要
 * @param {Record<string,object>} lgByPlannerTaskId
 *        sprint task.id（=== harness-pipelines.planner_task_id）→ normalizeLg 富数据
 * @returns {Array} areas[]
 */
export function buildFeed(tasks, journeyNameById = {}, progressById = {}, nowMs = 0, reportByInitiativeId = {}, lgByPlannerTaskId = {}) {
  const areaMap = new Map();

  for (const t of tasks) {
    const jId = t?.payload?.journey_id;
    const jName = jId ? (journeyNameById[jId] || null) : null;
    const item = toFeedItem(t, jName, progressById[t.id] || null, nowMs, reportByInitiativeId[t.id] || null, lgByPlannerTaskId[t.id] || null);
    const { _area: area, _group: group } = item;
    delete item._area; delete item._group;

    if (!areaMap.has(area.areaKey)) {
      areaMap.set(area.areaKey, { areaKey: area.areaKey, areaName: area.areaName, order: area.order, count: 0, groups: new Map() });
    }
    const a = areaMap.get(area.areaKey);
    a.count++;
    if (!a.groups.has(group.groupKey)) {
      a.groups.set(group.groupKey, { groupKey: group.groupKey, groupName: group.groupName, count: 0, tasks: [] });
    }
    const g = a.groups.get(group.groupKey);
    g.count++;
    g.tasks.push(item);
  }

  const statusRank = { active: 0, failed: 1, done: 2, canceled: 3 };
  return [...areaMap.values()]
    .sort((x, y) => x.order - y.order)
    .map((a) => ({
      areaKey: a.areaKey,
      areaName: a.areaName,
      order: a.order,
      count: a.count,
      groups: [...a.groups.values()]
        .sort((x, y) => y.count - x.count)
        .map((g) => ({
          ...g,
          tasks: g.tasks.sort((p, q) => {
            const r = (statusRank[p.status] ?? 9) - (statusRank[q.status] ?? 9);
            if (r !== 0) return r;
            return new Date(q.created_at).getTime() - new Date(p.created_at).getTime();
          }),
        })),
    }));
}

/**
 * 全局统计条（纯函数）
 * @param {object[]} tasks
 * @param {string} todayStr  Asia/Shanghai YYYY-MM-DD
 */
export function computeStats(tasks, todayStr) {
  let active = 0, done_today = 0, failed_today = 0, pr_this_month = 0;
  const month = todayStr.slice(0, 7);

  for (const t of tasks) {
    const s = normStatus(t.status);
    if (s === 'active') active++;

    const day = shanghaiDay(t.completed_at || t.updated_at || t.created_at);
    if (day === todayStr) {
      if (s === 'done') done_today++;
      if (s === 'failed') failed_today++;
    }

    const hasPr = !!(t.pr_url || (t.result && t.result.pr_url));
    if (hasPr && s === 'done') {
      const m = shanghaiDay(t.completed_at || t.created_at).slice(0, 7);
      if (m === month) pr_this_month++;
    }
  }
  return { active, done_today, failed_today, pr_this_month };
}
