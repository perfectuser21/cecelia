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

/**
 * 把一行 task 组装成战情室 feed item（纯函数）
 * @param {object} t            task row
 * @param {string|null} journeyName
 * @param {{pct:number, node:string}|null} progress
 * @param {number} nowMs
 */
export function toFeedItem(t, journeyName, progress, nowMs) {
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

  const pr_url = t.pr_url || (t.result && t.result.pr_url) || null;

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
    current_node: progress ? progress.node : null,
    fail_reason: status === 'failed' ? (t.error_message || null) : null,
    pr_url,
    detail_route: detailRoute(t, kind),
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
 * @returns {Array} areas[]
 */
export function buildFeed(tasks, journeyNameById = {}, progressById = {}, nowMs = 0) {
  const areaMap = new Map();

  for (const t of tasks) {
    const jId = t?.payload?.journey_id;
    const jName = jId ? (journeyNameById[jId] || null) : null;
    const item = toFeedItem(t, jName, progressById[t.id] || null, nowMs);
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
