/**
 * Task Generator Scheduler - 任务生成调度器
 * 负责在 Brain tick 中触发代码质量扫描
 */
import { getScheduler } from './task-generators/index.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import path from 'path';

const execAsync = promisify(exec);

// packages/brain/ 目录的绝对路径（不依赖进程 CWD）
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const BRAIN_PKG_DIR = path.resolve(__dirname, '..');

// 扫描状态
let lastScanDate = null;

// 扫描统计（用于 /api/brain/scan-status 端点）
const scanStats = {
  lastScanTime: null,
  issuesFound: 0,
  tasksGenerated: 0,
  todayGeneratedCount: 0,
  todayCountDate: null,
};

// 配置：从环境变量读取任务生成的 Initiative/KR 关联 ID
const TASK_GENERATOR_PROJECT_ID = process.env.TASK_GENERATOR_PROJECT_ID || null;
const TASK_GENERATOR_GOAL_ID = process.env.TASK_GENERATOR_GOAL_ID || null;

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

    // 先生成最新的 coverage 报告
    console.log('[task-generator] Generating coverage report...');
    try {
      await execAsync('npx vitest run --coverage', {
        cwd: BRAIN_PKG_DIR,
        timeout: 3 * 60 * 1000, // 3 分钟超时
      });
      console.log('[task-generator] Coverage report generated');
    } catch (coverageErr) {
      console.warn('[task-generator] Coverage generation failed, using existing file:', coverageErr.message);
    }

    const scheduler = getScheduler();

    // 执行扫描
    const issues = await scheduler.runScan();

    if (issues.length === 0) {
      console.log('[task-generator] No issues found');
      scanStats.lastScanTime = new Date();
      scanStats.issuesFound = 0;
      scanStats.tasksGenerated = 0;
      return { triggered: true, issues: 0, tasks: 0 };
    }

    // 生成任务
    const tasks = await scheduler.generateTasks(issues, async (taskData) => {
      // 创建任务到数据库，补充 project_id / goal_id / task_type
      const result = await pool.query(
        `INSERT INTO tasks (title, description, priority, status, tags, metadata, project_id, goal_id, task_type, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         RETURNING id`,
        [
          taskData.title,
          taskData.description,
          taskData.priority || 'P1',
          'queued',
          taskData.tags || [],
          taskData.metadata || {},
          TASK_GENERATOR_PROJECT_ID,
          TASK_GENERATOR_GOAL_ID,
          'dev',
        ]
      );

      return result.rows[0]?.id;
    });

    console.log(`[task-generator] Generated ${tasks.length} tasks from ${issues.length} issues`);

    // 更新扫描统计
    const nowDate = new Date().toISOString().split('T')[0];
    scanStats.lastScanTime = new Date();
    scanStats.issuesFound = issues.length;
    scanStats.tasksGenerated = tasks.length;
    if (scanStats.todayCountDate !== nowDate) {
      scanStats.todayGeneratedCount = 0;
      scanStats.todayCountDate = nowDate;
    }
    scanStats.todayGeneratedCount += tasks.length;

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

/**
 * 获取扫描状态（用于 /api/brain/scan-status 端点）
 * @returns {Object} {last_scan_time, issues_found, tasks_generated, today_generated_count}
 */
export function getScanStatus() {
  return {
    last_scan_time: scanStats.lastScanTime,
    issues_found: scanStats.issuesFound,
    tasks_generated: scanStats.tasksGenerated,
    today_generated_count: scanStats.todayGeneratedCount,
  };
}
