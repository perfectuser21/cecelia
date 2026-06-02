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
