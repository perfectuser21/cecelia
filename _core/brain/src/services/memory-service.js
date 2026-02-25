/**
 * Memory Service - 历史记忆搜索业务逻辑
 *
 * 职责：
 * - 封装 similarity.js 的向量搜索能力
 * - 提供递进式搜索（summary → detail → related）
 * - 返回统一的数据格式
 */

import SimilarityService from '../similarity.js';

export default class MemoryService {
  constructor(pool) {
    this.pool = pool;
    this.similarity = new SimilarityService(pool);
  }

  /**
   * 搜索相关历史（Summary 层）
   * @param {string} query - 搜索查询
   * @param {object} options - 搜索选项
   * @param {number} options.topK - 返回结果数量（默认 5）
   * @param {string} options.mode - 返回模式：'summary' | 'full'（默认 'summary'）
   * @returns {Promise<object>} - { matches: [...] }
   */
  async search(query, options = {}) {
    const { topK = 5, mode = 'summary' } = options;

    // 调用 similarity service
    const results = await this.similarity.searchWithVectors(query, { topK });

    // 根据模式返回不同格式
    if (mode === 'summary') {
      // Summary 模式：只返回 id, level, title, similarity, preview
      const matches = results.matches.map(match => ({
        id: match.id,
        level: match.level,
        title: match.title,
        similarity: match.score,
        preview: this._generatePreview(match.description)
      }));
      return { matches };
    }

    // Full 模式：返回完整信息
    return results;
  }

  /**
   * 查看完整详情（Detail 层）
   * @param {string} id - Task/Project/Goal ID
   * @returns {Promise<object>} - 完整对象信息
   */
  async getDetail(id) {
    // 先尝试从 tasks 查询
    let result = await this.pool.query(
      `SELECT
        id,
        'task' as level,
        title,
        description,
        status,
        metadata,
        created_at
      FROM tasks WHERE id = $1`,
      [id]
    );

    if (result.rows.length > 0) {
      return this._formatDetail(result.rows[0]);
    }

    // 再尝试从 projects 查询
    result = await this.pool.query(
      `SELECT
        id,
        'project' as level,
        name as title,
        description,
        metadata,
        created_at
      FROM projects WHERE id = $1`,
      [id]
    );

    if (result.rows.length > 0) {
      return this._formatDetail(result.rows[0]);
    }

    // 最后尝试从 goals 查询
    result = await this.pool.query(
      `SELECT
        id,
        'goal' as level,
        title,
        description,
        status,
        metadata,
        created_at
      FROM goals WHERE id = $1`,
      [id]
    );

    if (result.rows.length > 0) {
      return this._formatDetail(result.rows[0]);
    }

    // 未找到
    throw new Error(`Entity not found: ${id}`);
  }

  /**
   * 搜索相关任务（Related 层）
   * @param {string} baseId - 基准任务 ID
   * @param {object} options - 搜索选项
   * @param {number} options.topK - 返回结果数量（默认 5）
   * @param {boolean} options.excludeSelf - 是否排除自身（默认 true）
   * @returns {Promise<object>} - { matches: [...] }
   */
  async searchRelated(baseId, options = {}) {
    const { topK = 5, excludeSelf = true } = options;

    // 先获取基准任务的信息
    const base = await this.getDetail(baseId);

    // 使用基准任务的 title 作为查询
    const results = await this.similarity.searchWithVectors(base.title, { topK: topK * 2 });

    // 过滤掉自身（如果需要）
    let matches = results.matches;
    if (excludeSelf) {
      matches = matches.filter(m => m.id !== baseId);
    }

    // 限制返回数量
    matches = matches.slice(0, topK);

    // 返回 summary 格式
    return {
      matches: matches.map(match => ({
        id: match.id,
        level: match.level,
        title: match.title,
        similarity: match.score,
        preview: this._generatePreview(match.description)
      }))
    };
  }

  /**
   * 生成预览文本（前 100 字符）
   * @private
   */
  _generatePreview(description) {
    if (!description) return '';

    // 移除 Markdown 标记，提取纯文本
    const plainText = description
      .replace(/^#+ /gm, '')  // 移除标题
      .replace(/\*\*/g, '')    // 移除加粗
      .replace(/\n/g, ' ')     // 换行变空格
      .trim();

    // 截取前 100 字符
    if (plainText.length <= 100) {
      return plainText;
    }
    return plainText.substring(0, 100) + '...';
  }

  /**
   * 格式化详情数据
   * @private
   */
  _formatDetail(row) {
    return {
      id: row.id,
      level: row.level,
      title: row.title,
      description: row.description,
      status: row.status,
      metadata: row.metadata || {},
      created_at: row.created_at
    };
  }
}
