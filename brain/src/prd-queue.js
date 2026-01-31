/**
 * PRD Queue Management
 * 管理 PRD 执行队列，支持无头模式自动执行
 */

import pool from './db.js';

const PRD_QUEUE_KEY = 'prd_queue';

/**
 * 获取当前队列状态
 */
async function getQueue() {
  const result = await pool.query(
    'SELECT value_json FROM working_memory WHERE key = $1',
    [PRD_QUEUE_KEY]
  );

  if (result.rows.length === 0) {
    return {
      items: [],
      current_index: -1,
      status: 'idle',
      started_at: null,
      updated_at: null
    };
  }

  return result.rows[0].value_json;
}

/**
 * 初始化队列（从 PRD 文件列表）
 */
async function initQueue(prdPaths, projectPath = null) {
  const items = prdPaths.map((path, index) => ({
    id: index + 1,
    path,
    status: 'pending',
    pr_url: null,
    branch: null,
    started_at: null,
    completed_at: null,
    error: null
  }));

  const queue = {
    items,
    current_index: 0,
    status: 'ready',
    project_path: projectPath,
    started_at: null,
    updated_at: new Date().toISOString()
  };

  await pool.query(`
    INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
  `, [PRD_QUEUE_KEY, queue]);

  return queue;
}

/**
 * 获取下一个待执行的 PRD
 */
async function getNextPrd() {
  const queue = await getQueue();

  if (queue.status === 'idle' || queue.items.length === 0) {
    return null;
  }

  // 找到第一个 pending 的 PRD
  const next = queue.items.find(item => item.status === 'pending');

  if (!next) {
    return null; // 全部完成
  }

  return {
    ...next,
    project_path: queue.project_path,
    total: queue.items.length,
    completed: queue.items.filter(i => i.status === 'done').length
  };
}

/**
 * 开始执行当前 PRD
 */
async function startCurrentPrd() {
  const queue = await getQueue();
  const next = queue.items.find(item => item.status === 'pending');

  if (!next) {
    return { success: false, error: 'No pending PRD' };
  }

  next.status = 'in_progress';
  next.started_at = new Date().toISOString();
  queue.status = 'running';
  queue.started_at = queue.started_at || new Date().toISOString();
  queue.updated_at = new Date().toISOString();

  await pool.query(`
    UPDATE working_memory SET value_json = $1, updated_at = NOW()
    WHERE key = $2
  `, [queue, PRD_QUEUE_KEY]);

  return { success: true, prd: next };
}

/**
 * 完成当前 PRD
 */
async function completePrd(prdId, prUrl, branch) {
  const queue = await getQueue();
  const item = queue.items.find(i => i.id === prdId);

  if (!item) {
    return { success: false, error: 'PRD not found' };
  }

  item.status = 'done';
  item.pr_url = prUrl;
  item.branch = branch;
  item.completed_at = new Date().toISOString();

  // 检查是否全部完成
  const allDone = queue.items.every(i => i.status === 'done');
  if (allDone) {
    queue.status = 'completed';
  }

  queue.updated_at = new Date().toISOString();

  await pool.query(`
    UPDATE working_memory SET value_json = $1, updated_at = NOW()
    WHERE key = $2
  `, [queue, PRD_QUEUE_KEY]);

  return {
    success: true,
    all_done: allDone,
    next: allDone ? null : queue.items.find(i => i.status === 'pending')
  };
}

/**
 * 标记 PRD 失败
 */
async function failPrd(prdId, error) {
  const queue = await getQueue();
  const item = queue.items.find(i => i.id === prdId);

  if (!item) {
    return { success: false, error: 'PRD not found' };
  }

  item.status = 'failed';
  item.error = error;
  item.completed_at = new Date().toISOString();

  queue.status = 'paused'; // 失败后暂停队列
  queue.updated_at = new Date().toISOString();

  await pool.query(`
    UPDATE working_memory SET value_json = $1, updated_at = NOW()
    WHERE key = $2
  `, [queue, PRD_QUEUE_KEY]);

  return { success: true, paused: true };
}

/**
 * 重试失败的 PRD
 */
async function retryFailed() {
  const queue = await getQueue();

  for (const item of queue.items) {
    if (item.status === 'failed') {
      item.status = 'pending';
      item.error = null;
      item.started_at = null;
      item.completed_at = null;
    }
  }

  queue.status = 'ready';
  queue.updated_at = new Date().toISOString();

  await pool.query(`
    UPDATE working_memory SET value_json = $1, updated_at = NOW()
    WHERE key = $2
  `, [queue, PRD_QUEUE_KEY]);

  return { success: true };
}

/**
 * 清空队列
 */
async function clearQueue() {
  await pool.query(
    'DELETE FROM working_memory WHERE key = $1',
    [PRD_QUEUE_KEY]
  );

  return { success: true };
}

/**
 * 获取队列摘要（给 /status 用）
 */
async function getQueueSummary() {
  const queue = await getQueue();

  if (queue.status === 'idle' || queue.items.length === 0) {
    return null;
  }

  return {
    status: queue.status,
    total: queue.items.length,
    pending: queue.items.filter(i => i.status === 'pending').length,
    in_progress: queue.items.filter(i => i.status === 'in_progress').length,
    done: queue.items.filter(i => i.status === 'done').length,
    failed: queue.items.filter(i => i.status === 'failed').length,
    current: queue.items.find(i => i.status === 'in_progress') ||
             queue.items.find(i => i.status === 'pending'),
    project_path: queue.project_path,
    started_at: queue.started_at
  };
}

export {
  getQueue,
  initQueue,
  getNextPrd,
  startCurrentPrd,
  completePrd,
  failPrd,
  retryFailed,
  clearQueue,
  getQueueSummary
};
