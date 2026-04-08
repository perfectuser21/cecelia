/**
 * Pipeline Patrol - 巡航模块
 *
 * Brain tick 的周期性模块，与 zombie-sweep / health-monitor 平级。
 * 不进入 pipeline 内部，只在外围观察所有活跃的 .dev-mode 文件：
 *
 * 1. 扫描主仓库 + 所有 worktree 中的 .dev-mode.* 文件
 * 2. 解析每个文件：当前 stage、started 时间、retry_count、last_block_reason
 * 3. 判断是否卡住（stage 停留超过阈值无进展）
 * 4. 卡住时：创建 pipeline_rescue 诊断任务到 Brain tasks 表
 * 5. 进程已死但 pipeline 未完成时：创建接管任务继续执行
 */

import { execSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import path from 'path';

// 卡住阈值（毫秒）
const STAGE_TIMEOUT_MS = {
  step_1_spec: 20 * 60 * 1000,       // Stage 1: 20 分钟
  step_2_code: 20 * 60 * 1000,       // Stage 2: 20 分钟
  step_3_integrate: 90 * 60 * 1000,  // Stage 3（等 CI）: 90 分钟
  step_4_ship: 15 * 60 * 1000,       // Stage 4: 15 分钟
};

// 默认阈值（未知 stage 用 20 分钟）
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

// 防止重复创建任务的冷却时间（同一个 branch 的 pipeline_rescue 任务 24 小时内不重复创建）
// 延长至 24h 防止 canceled 后立即重建的循环：cancel → 2h 后重建 → cancel → 循环
const DEDUP_COOLDOWN_MS = 24 * 60 * 60 * 1000;
// quarantined 冷却期更长（72h）：rescue 本身失败说明环境有问题，不应频繁重试
const DEDUP_QUARANTINE_COOLDOWN_MS = 72 * 60 * 60 * 1000;

// 同一分支 rescue 任务 quarantined 次数上限：超限后标记 cleanup_done，永久停止创建
// 背景：rescue 任务反复被 watchdog liveness_dead 杀死，是陈旧 .dev-mode 文件的主要失败来源（85%）
const MAX_RESCUE_QUARANTINE = 3;

/**
 * 获取主仓库根路径
 * @returns {string|null}
 */
function getMainRepoPath() {
  try {
    return execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * 获取所有 worktree 路径（包括主仓库）
 * @returns {string[]}
 */
function getAllWorktreePaths() {
  const paths = [];
  const mainRepo = getMainRepoPath();
  if (!mainRepo) return paths;

  try {
    const output = execSync('git worktree list --porcelain', {
      encoding: 'utf8',
      timeout: 10000,
      cwd: mainRepo,
    });

    const blocks = output.trim().split('\n\n');
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          paths.push(line.slice(9));
        }
      }
    }
  } catch {
    // fallback: 至少返回主仓库
    if (mainRepo) paths.push(mainRepo);
  }

  return paths;
}

/**
 * 扫描指定目录中的 .dev-mode.* 文件
 * @param {string} dirPath
 * @returns {Array<{filePath: string, branch: string}>}
 */
function scanDevModeFiles(dirPath) {
  const results = [];
  try {
    const files = readdirSync(dirPath);
    for (const file of files) {
      if (file.startsWith('.dev-mode.') && !file.endsWith('.lock')) {
        const branch = file.replace('.dev-mode.', '');
        results.push({
          filePath: path.join(dirPath, file),
          branch,
        });
      }
    }
  } catch {
    // 目录不可读，跳过
  }
  return results;
}

/**
 * 解析 .dev-mode 文件内容
 * @param {string} filePath
 * @returns {object|null}
 */
function parseDevMode(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');
    const parsed = {
      raw: content,
      branch: '',
      started: null,
      steps: {},
      retry_count: 0,
      last_block_reason: '',
      cleanup_done: false,
      currentStage: null,
      mtime: null,
    };

    // 获取文件修改时间作为最后活动时间的参考
    try {
      const stat = statSync(filePath);
      parsed.mtime = stat.mtime;
    } catch { /* ignore */ }

    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('branch:')) {
        parsed.branch = trimmed.replace('branch:', '').trim();
      } else if (trimmed.startsWith('started:')) {
        const ts = trimmed.replace('started:', '').trim();
        parsed.started = new Date(ts);
      } else if (trimmed.startsWith('retry_count:')) {
        parsed.retry_count = parseInt(trimmed.replace('retry_count:', '').trim(), 10) || 0;
      } else if (trimmed.startsWith('last_block_reason:')) {
        parsed.last_block_reason = trimmed.replace('last_block_reason:', '').trim();
      } else if (trimmed.startsWith('cleanup_done:')) {
        parsed.cleanup_done = trimmed.includes('true');
      } else if (trimmed.startsWith('step_')) {
        const match = trimmed.match(/^(step_\d+_\w+):\s*(.+)$/);
        if (match) {
          parsed.steps[match[1]] = match[2].trim();
        }
      }
    }

    // 确定当前 stage：找到第一个非 done 的 step
    const stepOrder = ['step_0_worktree', 'step_1_spec', 'step_2_code', 'step_3_integrate', 'step_4_ship'];
    for (const step of stepOrder) {
      if (parsed.steps[step] && parsed.steps[step] !== 'done') {
        parsed.currentStage = step;
        break;
      }
      if (!parsed.steps[step]) {
        parsed.currentStage = step;
        break;
      }
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * 检查对应分支是否有活跃的 agent 进程
 * @param {string} branch
 * @returns {boolean}
 */
function isProcessAlive(branch) {
  try {
    const result = execSync(
      `ps aux | grep -v grep | grep "${branch}" | head -5`,
      { encoding: 'utf8', timeout: 5000 }
    );
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * 检查 .dev-lock 文件是否存在（表示有活跃的 dev session）
 * @param {string} dirPath
 * @param {string} branch
 * @returns {boolean}
 */
function hasDevLock(dirPath, branch) {
  const lockFile = path.join(dirPath, `.dev-lock.${branch}`);
  return existsSync(lockFile);
}

/**
 * 将 .dev-mode 文件标记为 cleanup_done: true，停止后续 patrol 扫描
 * @param {string} dirPath - worktree 路径
 * @param {string} branch - 分支名
 */
function writeCleanupDone(dirPath, branch) {
  const devModeFile = path.join(dirPath, `.dev-mode.${branch}`);
  if (!existsSync(devModeFile)) return;
  try {
    let content = readFileSync(devModeFile, 'utf8');
    if (content.includes('cleanup_done: true')) return;
    if (content.includes('cleanup_done:')) {
      content = content.replace(/cleanup_done:\s*\S+/, 'cleanup_done: true');
    } else {
      content = content.trimEnd() + '\ncleanup_done: true\n';
    }
    writeFileSync(devModeFile, content, 'utf8');
    console.log(`[pipeline-patrol] 标记 cleanup_done: ${branch}（rescue quarantine 次数达上限 ${MAX_RESCUE_QUARANTINE}）`);
  } catch (err) {
    console.error(`[pipeline-patrol] 写入 cleanup_done 失败 (${branch}):`, err.message);
  }
}

/**
 * 判断 pipeline 是否卡住
 * @param {object} parsed - parseDevMode 返回的对象
 * @returns {{stuck: boolean, reason: string, elapsedMs: number}}
 */
function checkStuck(parsed) {
  if (!parsed.currentStage || parsed.cleanup_done) {
    return { stuck: false, reason: '', elapsedMs: 0 };
  }

  const timeoutMs = STAGE_TIMEOUT_MS[parsed.currentStage] || DEFAULT_TIMEOUT_MS;

  const lastActivity = parsed.mtime || parsed.started;
  if (!lastActivity) {
    return { stuck: false, reason: 'no_timestamp', elapsedMs: 0 };
  }

  const elapsedMs = Date.now() - new Date(lastActivity).getTime();

  if (elapsedMs > timeoutMs) {
    const elapsedMin = Math.round(elapsedMs / 60000);
    const timeoutMin = Math.round(timeoutMs / 60000);
    return {
      stuck: true,
      reason: `${parsed.currentStage} 停留 ${elapsedMin} 分钟（阈值 ${timeoutMin} 分钟）`,
      elapsedMs,
    };
  }

  return { stuck: false, reason: '', elapsedMs };
}

/**
 * 创建 pipeline_rescue 任务到 Brain tasks 表
 * @param {import('pg').Pool} dbPool
 * @param {object} info - 诊断信息
 * @returns {Promise<{created: boolean, taskId?: string, reason?: string}>}
 */
async function createRescueTask(dbPool, info) {
  const { branch, currentStage, blockReason, elapsedMs, worktreePath, isOrphan } = info;

  // 封顶检查：同一分支 quarantined rescue 次数 >= MAX_RESCUE_QUARANTINE 时，
  // 写 cleanup_done 到 .dev-mode 文件，永久停止该分支的 rescue 循环
  const quarantineCountResult = await dbPool.query(`
    SELECT COUNT(*) as count FROM tasks
    WHERE task_type = 'pipeline_rescue'
      AND title LIKE $1
      AND status = 'quarantined'
  `, [`%${branch}%`]);
  const quarantineCount = parseInt(quarantineCountResult.rows[0]?.count || '0', 10);
  if (quarantineCount >= MAX_RESCUE_QUARANTINE) {
    writeCleanupDone(worktreePath, branch);
    return {
      created: false,
      reason: `quarantine_cap: ${quarantineCount} 次 quarantined，已标记 cleanup_done`,
    };
  }

  // 去重检查：同一 branch 的 pipeline_rescue 任务在冷却期内不重复创建
  // 条件1：任务仍活跃（in_progress/queued/paused 等）→ 不重建
  // 条件2：24h 内已有 completed/cancelled/canceled 任务 → 不重建
  // 条件3：72h 内已有 quarantined 任务 → 不重建（rescue 自身失败说明环境问题，需更长冷却）
  const dedupResult = await dbPool.query(`
    SELECT id, created_at, status FROM tasks
    WHERE task_type = 'pipeline_rescue'
      AND title LIKE $1
      AND (
        status NOT IN ('completed', 'cancelled', 'canceled', 'failed', 'quarantined')
        OR (status IN ('completed', 'cancelled', 'canceled') AND created_at > NOW() - INTERVAL '24 hours')
        OR (status = 'quarantined' AND created_at > NOW() - INTERVAL '72 hours')
      )
    LIMIT 1
  `, [`%${branch}%`]);

  if (dedupResult.rows.length > 0) {
    return {
      created: false,
      reason: `dedup: 已有任务 ${dedupResult.rows[0].id}`,
    };
  }

  const titlePrefix = isOrphan ? '[Orphan]' : '[Stuck]';
  const title = `${titlePrefix} Pipeline Rescue: ${branch}`;

  const elapsedMin = Math.round(elapsedMs / 60000);
  const description = [
    `Pipeline Patrol 检测到异常：`,
    `- 分支: ${branch}`,
    `- 当前阶段: ${currentStage || 'unknown'}`,
    `- 停留时间: ${elapsedMin} 分钟`,
    `- 阻塞原因: ${blockReason || 'unknown'}`,
    `- Worktree: ${worktreePath}`,
    `- 类型: ${isOrphan ? '进程已死（孤儿 pipeline）' : '阶段超时'}`,
    ``,
    `请诊断并恢复该 pipeline，或关闭对应任务。`,
  ].join('\n');

  const result = await dbPool.query(`
    INSERT INTO tasks (title, description, status, priority, task_type, trigger_source, domain, payload)
    VALUES ($1, $2, 'queued', 'P1', 'pipeline_rescue', 'brain_auto', 'agent_ops', $3)
    RETURNING id
  `, [
    title,
    description,
    JSON.stringify({
      branch,
      current_stage: currentStage,
      block_reason: blockReason,
      elapsed_ms: elapsedMs,
      worktree_path: worktreePath,
      is_orphan: isOrphan,
      detected_at: new Date().toISOString(),
    }),
  ]);

  const taskId = result.rows[0]?.id;
  console.log(`[pipeline-patrol] 创建 rescue 任务: ${title} (id: ${taskId})`);

  return { created: true, taskId };
}

/**
 * Pipeline Patrol 主函数
 *
 * 扫描所有活跃 .dev-mode 文件，检测卡住或孤儿 pipeline，
 * 必要时创建 pipeline_rescue 任务。
 *
 * @param {import('pg').Pool} dbPool - PostgreSQL 连接池
 * @returns {Promise<{scanned: number, stuck: number, rescued: number, details: Array}>}
 */
export async function runPipelinePatrol(dbPool) {
  const result = {
    scanned: 0,
    stuck: 0,
    rescued: 0,
    details: [],
  };

  // 1. 获取所有 worktree 路径
  const worktreePaths = getAllWorktreePaths();
  if (worktreePaths.length === 0) {
    console.log('[pipeline-patrol] 无法获取 worktree 列表，跳过');
    return result;
  }

  // 2. 扫描所有 .dev-mode 文件
  const allDevModes = [];
  for (const wtPath of worktreePaths) {
    const devModes = scanDevModeFiles(wtPath);
    for (const dm of devModes) {
      allDevModes.push({ ...dm, worktreePath: wtPath });
    }
  }

  result.scanned = allDevModes.length;

  if (allDevModes.length === 0) {
    return result;
  }

  // 3. 逐个分析
  for (const dm of allDevModes) {
    const parsed = parseDevMode(dm.filePath);
    if (!parsed) continue;

    // 已完成的 pipeline 跳过
    if (parsed.cleanup_done) continue;
    if (!parsed.currentStage) continue;

    // step_0_worktree 阶段不检测（刚创建）
    if (parsed.currentStage === 'step_0_worktree') continue;

    // 检查是否卡住
    const stuckCheck = checkStuck(parsed);

    // 检查是否孤儿（进程死亡但 pipeline 未完成）
    const lockExists = hasDevLock(dm.worktreePath, dm.branch);
    const processAlive = isProcessAlive(dm.branch);
    const isOrphan = !lockExists && !processAlive && parsed.currentStage !== null;

    if (!stuckCheck.stuck && !isOrphan) continue;

    result.stuck++;

    const detail = {
      branch: dm.branch,
      worktreePath: dm.worktreePath,
      currentStage: parsed.currentStage,
      elapsedMs: stuckCheck.elapsedMs,
      blockReason: parsed.last_block_reason,
      retryCount: parsed.retry_count,
      isOrphan,
      isStuck: stuckCheck.stuck,
      stuckReason: stuckCheck.reason,
    };

    // 4. 创建 rescue 任务
    try {
      const rescueResult = await createRescueTask(dbPool, {
        branch: dm.branch,
        currentStage: parsed.currentStage,
        blockReason: parsed.last_block_reason || stuckCheck.reason,
        elapsedMs: stuckCheck.elapsedMs,
        worktreePath: dm.worktreePath,
        isOrphan,
      });

      detail.rescued = rescueResult.created;
      detail.rescueTaskId = rescueResult.taskId;
      detail.rescueSkipReason = rescueResult.reason;

      if (rescueResult.created) {
        result.rescued++;
      }
    } catch (err) {
      detail.rescueError = err.message;
      console.error(`[pipeline-patrol] 创建 rescue 任务失败 (${dm.branch}):`, err.message);
    }

    result.details.push(detail);
  }

  return result;
}

export {
  // 用于测试的内部函数
  getMainRepoPath as _getMainRepoPath,
  getAllWorktreePaths as _getAllWorktreePaths,
  scanDevModeFiles as _scanDevModeFiles,
  parseDevMode as _parseDevMode,
  checkStuck as _checkStuck,
  writeCleanupDone as _writeCleanupDone,
  STAGE_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
  DEDUP_COOLDOWN_MS,
  DEDUP_QUARANTINE_COOLDOWN_MS,
  MAX_RESCUE_QUARANTINE,
};
