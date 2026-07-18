#!/usr/bin/env node
/**
 * repair-blocked-tasks.js — 修补 5 个因空 description + 非法 priority P3 被 preflight 三振 blocked 的 codex_test_gen 任务
 *
 * Sprint: 07180825-codex-gen-description-fix
 * Task:   c3528706-8c83-4df0-a2af-31e6483ec05f
 *
 * 目标任务 ID 前缀：83fc5def、613aa09e、f4bd8692、06e1b20e、433b3625
 *
 * 操作：
 *   Brain API 内置复活路径（task-tasks.js 第 339-361 行）：
 *   当 description 被补齐且任务 blocked_reason='pre_flight_rejected' 时，
 *   自动将 status 回到 queued 并清零 pre_flight 计数器。
 *   因此只需 PATCH description 字段，无需直接操作 status。
 *
 * 幂等：可重复执行，不会重复修改已修补的任务。
 */

const BRAIN_URL = process.env.BRAIN_URL || process.env.XIAN_BRAIN_URL || 'http://host.docker.internal:5221';

const TARGET_ID_PREFIXES = [
  '83fc5def',
  '613aa09e',
  'f4bd8692',
  '06e1b20e',
  '433b3625',
];

async function fetchJson(url, opts = {}) {
  const resp = await fetch(url, opts);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${url}: ${text.slice(0, 300)}`);
  }
  return resp.json();
}

async function findTaskByPrefix(prefix) {
  // 先通过 codex_test_gen + blocked 状态搜索
  const url = `${BRAIN_URL}/api/brain/tasks?task_type=codex_test_gen&status=blocked&limit=100`;
  const data = await fetchJson(url);
  const tasks = Array.isArray(data) ? data : (data.tasks || data.data || []);
  const found = tasks.find((t) => t.id && t.id.startsWith(prefix));
  if (!found) {
    // 也尝试 queued 状态（可能已被修补过）
    const queuedUrl = `${BRAIN_URL}/api/brain/tasks?task_type=codex_test_gen&status=queued&limit=200`;
    const queuedData = await fetchJson(queuedUrl).catch(() => []);
    const queuedTasks = Array.isArray(queuedData) ? queuedData : (queuedData.tasks || queuedData.data || []);
    return queuedTasks.find((t) => t.id && t.id.startsWith(prefix)) || null;
  }
  return found;
}

async function repairTask(task) {
  const targetFile = task.payload?.target_file || task.payload?.target_file_path || `packages/brain/src/unknown-${task.id.slice(0, 8)}.js`;
  const description = `为 ${targetFile} 生成 vitest 测试：使用 mock 隔离依赖，覆盖主要分支`;

  // 利用 Brain API 内置复活路径：仅发送 description，
  // task-tasks.js 检测到 blocked_reason='pre_flight_rejected' 时自动回 queued + 清零计数
  const patchBody = {
    description,
    priority: 'P2',
  };

  // 注意：PATCH /api/brain/tasks/:id 由 routes/tasks.js 处理（只接受 status=in_progress/completed/failed）
  // 真正支持 description 字段的是 task-tasks.js，挂载路径为 /api/brain/tasks/tasks/:id
  const updated = await fetchJson(`${BRAIN_URL}/api/brain/tasks/tasks/${task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patchBody),
  });

  return { id: task.id, targetFile, description, updatedStatus: updated.status };
}

async function main() {
  console.log(`[repair] Brain URL: ${BRAIN_URL}`);
  console.log(`[repair] 开始修补 ${TARGET_ID_PREFIXES.length} 个 blocked 任务...\n`);

  const results = [];

  for (const prefix of TARGET_ID_PREFIXES) {
    console.log(`[repair] 查找 ID 前缀 ${prefix}...`);
    let task;
    try {
      task = await findTaskByPrefix(prefix);
    } catch (err) {
      console.error(`  ✗ 查找失败: ${err.message}`);
      results.push({ prefix, status: 'lookup_failed', error: err.message });
      continue;
    }

    if (!task) {
      console.warn(`  ⚠ 未找到 ID 前缀 ${prefix} 的任务（可能已删除或 ID 不匹配）`);
      results.push({ prefix, status: 'not_found' });
      continue;
    }

    console.log(`  找到: id=${task.id} status=${task.status} priority=${task.priority} desc=${Boolean(task.description)}`);

    if (task.status === 'queued' && task.description && task.priority === 'P2') {
      console.log(`  ✓ 已修补（幂等跳过）`);
      results.push({ prefix, id: task.id, status: 'already_repaired' });
      continue;
    }

    try {
      const repaired = await repairTask(task);
      console.log(`  ✓ 修补成功: status=${repaired.updatedStatus} description 长度=${repaired.description.length} priority=P2`);
      results.push({ prefix, id: task.id, status: 'repaired', updatedStatus: repaired.updatedStatus });
    } catch (err) {
      console.error(`  ✗ 修补失败: ${err.message}`);
      results.push({ prefix, id: task.id, status: 'patch_failed', error: err.message });
    }
  }

  console.log('\n[repair] 修补结果摘要:');
  for (const r of results) {
    const icon = r.status === 'repaired' || r.status === 'already_repaired' ? '✓' : '✗';
    const detail = r.status === 'repaired' ? ` → ${r.updatedStatus}` : '';
    console.log(`  ${icon} ${r.prefix}: ${r.status}${r.id ? ` (${r.id.slice(0, 12)})` : ''}${detail}`);
  }

  const succeeded = results.filter((r) => r.status === 'repaired' || r.status === 'already_repaired').length;
  const notFound = results.filter((r) => r.status === 'not_found').length;
  const failed = results.filter((r) => r.status === 'patch_failed' || r.status === 'lookup_failed').length;

  console.log(`\n[repair] 完成: ${succeeded} 修补成功, ${notFound} 未找到, ${failed} 失败`);

  if (notFound > 0) {
    console.log('\n[repair] 注意: 未找到的任务可能已不在 blocked/queued 状态。可执行以下命令确认:');
    console.log(`  curl -s "${BRAIN_URL}/api/brain/tasks?task_type=codex_test_gen&limit=20"`);
  }

  if (failed > 0) {
    process.exit(1);
  }

  // 最终验证
  console.log('\n[repair] 验证修补结果...');
  for (const prefix of TARGET_ID_PREFIXES) {
    try {
      const task = await findTaskByPrefix(prefix);
      if (task) {
        const descOk = Boolean(task.description && task.description.trim().length >= 20);
        const statusOk = task.status === 'queued';
        const icon = descOk && statusOk ? '✓' : '⚠';
        console.log(`  ${icon} ${prefix}: status=${task.status} desc_ok=${descOk} priority=${task.priority}`);
      } else {
        console.log(`  ⚠ ${prefix}: 未找到（可能在其他状态）`);
      }
    } catch {
      console.log(`  ⚠ ${prefix}: 验证查询失败`);
    }
  }
}

main().catch((err) => {
  console.error('[repair] 脚本执行失败:', err.message);
  process.exit(1);
});
