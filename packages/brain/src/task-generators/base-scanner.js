/**
 * 基础扫描器接口
 * 所有扫描器必须继承此类
 */
class BaseScanner {
  constructor(name, options = {}) {
    this.name = name;
    this.options = options;
  }

  /**
   * 执行扫描，返回问题列表
   * @returns {Promise<Array>} 扫描结果列表
   */
  async scan() {
    throw new Error('scan() must be implemented by subclass');
  }

  /**
   * 获取扫描器名称
   * @returns {string}
   */
  getName() {
    return this.name;
  }

  /**
   * 获取阈值配置
   * @returns {Object}
   */
  getThreshold() {
    return this.options.threshold || {};
  }

  /**
   * 将问题转换为任务
   * @param {Object} issue 扫描发现的问题
   * @returns {Promise<Object>} 任务对象
   */
  async generateTask(_issue) {
    throw new Error('generateTask() must be implemented by subclass');
  }

  /**
   * 保存扫描结果到数据库
   * @param {Object} issue 扫描发现的问题
   * @param {string} taskId 关联的任务 ID
   * @returns {Promise<void>}
   */
  async saveScanResult(issue, taskId) {
    const pool = (await import('../db.js')).default;

    await pool.query(
      `INSERT INTO scan_results
       (scanner_name, module_path, issue_type, current_value, target_value, task_id, scanned_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        this.name,
        issue.module_path,
        issue.issue_type,
        issue.current_value,
        issue.target_value,
        taskId
      ]
    );
  }
}

export default BaseScanner;
