/**
 * 扫描调度器
 * 负责定期执行扫描并生成任务
 */
import CoverageScanner from './coverage-scanner.js';
import ComplexityScanner from './complexity-scanner.js';
import UntestedScanner from './untested-scanner.js';

class ScannerScheduler {
  constructor(options = {}) {
    this.scanners = [];
    this.options = {
      scanInterval: options.scanInterval || 24 * 60 * 60 * 1000, // 默认每天扫描一次
      maxTasksPerScan: options.maxTasksPerScan || 3, // 每次扫描最多生成任务数
      ...options
    };

    this.lastScanTime = null;
  }

  /**
   * 注册扫描器
   * @param {BaseScanner} scanner 扫描器实例
   */
  registerScanner(scanner) {
    this.scanners.push(scanner);
    console.log(`[ScannerScheduler] Registered scanner: ${scanner.getName()}`);
  }

  /**
   * 初始化默认扫描器
   */
  initDefaultScanners() {
    this.registerScanner(new CoverageScanner());
    this.registerScanner(new ComplexityScanner());
    this.registerScanner(new UntestedScanner());
  }

  /**
   * 执行所有扫描
   * @returns {Promise<Array>} 所有扫描发现的问题
   */
  async runScan() {
    console.log('[ScannerScheduler] Starting scan...');
    const allIssues = [];

    for (const scanner of this.scanners) {
      try {
        const issues = await scanner.scan();
        console.log(`[ScannerScheduler] ${scanner.getName()} found ${issues.length} issues`);
        allIssues.push(...issues.map(issue => ({
          ...issue,
          scanner: scanner.getName()
        })));
      } catch (error) {
        console.error(`[ScannerScheduler] Error running ${scanner.getName()}:`, error.message);
      }
    }

    this.lastScanTime = new Date();
    console.log(`[ScannerScheduler] Scan completed. Total issues: ${allIssues.length}`);

    return allIssues;
  }

  /**
   * 将扫描问题转换为任务
   * @param {Array} issues 扫描问题列表
   * @param {Function} createTaskFn 创建任务的回调函数
   * @returns {Promise<Array>} 生成的任务列表
   */
  async generateTasks(issues, createTaskFn) {
    const tasks = [];
    const maxTasks = this.options.maxTasksPerScan;

    // 按优先级排序（high > medium > low）
    const sortedIssues = [...issues].sort((a, b) => {
      const priority = { high: 0, medium: 1, low: 2 };
      return priority[a.severity || 'low'] - priority[b.severity || 'low'];
    });

    // 取前 maxTasks 个问题
    const selectedIssues = sortedIssues.slice(0, maxTasks);

    for (const issue of selectedIssues) {
      const scanner = this.scanners.find(s => s.getName() === issue.scanner);
      if (!scanner) continue;

      try {
        const task = await scanner.generateTask(issue);

        // 调用 createTaskFn 将任务写入 DB
        if (createTaskFn) {
          try {
            const taskId = await createTaskFn(task);
            task.id = taskId;
          } catch (createErr) {
            console.error(`[ScannerScheduler] Error creating task for ${issue.module_path}:`, createErr.message);
          }
        }

        tasks.push(task);
        console.log(`[ScannerScheduler] Generated task: ${task.title}`);
      } catch (error) {
        console.error(`[ScannerScheduler] Error generating task for ${issue.module_path}:`, error.message);
      }
    }

    return tasks;
  }

  /**
   * 获取扫描器列表
   * @returns {Array} 扫描器列表
   */
  getScanners() {
    return this.scanners.map(s => ({
      name: s.getName(),
      threshold: s.getThreshold()
    }));
  }

  /**
   * 获取上次扫描时间
   * @returns {Date|null}
   */
  getLastScanTime() {
    return this.lastScanTime;
  }

  /**
   * 检查是否需要扫描
   * @returns {boolean}
   */
  shouldScan() {
    if (!this.lastScanTime) return true;

    const timeSinceLastScan = Date.now() - this.lastScanTime.getTime();
    return timeSinceLastScan >= this.options.scanInterval;
  }
}

// 单例实例
let schedulerInstance = null;

/**
 * 获取扫描调度器实例
 * @param {Object} options 配置选项
 * @returns {ScannerScheduler}
 */
export function getScheduler(options = {}) {
  if (!schedulerInstance) {
    schedulerInstance = new ScannerScheduler(options);
    schedulerInstance.initDefaultScanners();
  }
  return schedulerInstance;
}

/**
 * 重置调度器实例（用于测试）
 */
export function resetScheduler() {
  schedulerInstance = null;
}

export default ScannerScheduler;
