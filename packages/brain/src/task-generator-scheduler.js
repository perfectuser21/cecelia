/**
 * Task Generator Scheduler - 任务生成调度器
 * 负责在 Brain tick 中触发代码质量扫描
 */
import { getScheduler } from './task-generators/index.js';

// 扫描状态
let lastScanDate = null;

/**
 * 触发代码质量扫描（每天首次 tick 时执行）
 * @param {Object} pool 数据库连接池
 * @returns {Promise<Object>} 扫描结果
 */
export async function triggerCodeQualityScan(pool) {
  const today = new Date().toISOString().split('T')[0];

  // 每天只扫描一次
  if (lastScanDate === today) {
    console.log('[task-generator] Already scanned today, skipping');
    return { triggered: false, reason: 'already_scanned_today' };
  }

  lastScanDate = today;

  try {
    console.log('[task-generator] Starting code quality scan...');

    const scheduler = getScheduler();

    // 执行扫描
    const issues = await scheduler.runScan();

    if (issues.length === 0) {
      console.log('[task-generator] No issues found');
      return { triggered: true, issues: 0, tasks: 0 };
    }

    // 生成任务
    const tasks = await scheduler.generateTasks(issues, async (taskData) => {
      // 创建任务到数据库
      const result = await pool.query(
        `INSERT INTO tasks (title, description, priority, status, tags, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         RETURNING id`,
        [
          taskData.title,
          taskData.description,
          taskData.priority || 'P1',
          'queued',
          taskData.tags || [],
          taskData.metadata || {}
        ]
      );

      return result.rows[0]?.id;
    });

    console.log(`[task-generator] Generated ${tasks.length} tasks from ${issues.length} issues`);

    return {
      triggered: true,
      issues: issues.length,
      tasks: tasks.length,
      taskIds: tasks.map(t => t.id).filter(Boolean)
    };
  } catch (error) {
    console.error('[task-generator] Scan error:', error.message);
    return { triggered: false, error: error.message };
  }
}

/**
 * 获取扫描调度器状态
 * @returns {Object}
 */
export function getScannerStatus() {
  const scheduler = getScheduler();
  return {
    scanners: scheduler.getScanners(),
    lastScanTime: scheduler.getLastScanTime(),
    shouldScan: scheduler.shouldScan()
  };
}
