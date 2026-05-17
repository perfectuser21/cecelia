/**
 * 代码覆盖率扫描器
 * 识别覆盖率低于阈值的模块
 */
import BaseScanner from './base-scanner.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const _execAsync = promisify(exec);

// 使用 import.meta.url 计算绝对路径，不依赖进程 CWD
// task-generators/ → packages/brain/coverage/
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DEFAULT_COVERAGE_DIR = path.resolve(__dirname, '../../coverage');

class CoverageScanner extends BaseScanner {
  constructor(options = {}) {
    super('coverage', {
      threshold: {
        minCoverage: options.minCoverage || 70, // 默认 70%
        ...options.threshold
      },
      coverageDir: options.coverageDir || DEFAULT_COVERAGE_DIR,
      sourceDir: options.sourceDir || 'packages/brain/src'
    });
  }

  /**
   * 执行扫描
   * @returns {Promise<Array>} 覆盖率问题列表
   */
  async scan() {
    const issues = [];
    const { coverageDir, sourceDir, threshold } = this.options;

    // 检查是否有覆盖率报告
    const coveragePath = path.resolve(coverageDir, 'coverage-summary.json');

    if (!fs.existsSync(coveragePath)) {
      console.log('[CoverageScanner] No coverage report found, skipping scan');
      return issues;
    }

    try {
      const coverageData = JSON.parse(fs.readFileSync(coveragePath, 'utf-8'));
      const minCoverage = threshold.minCoverage;

      // 遍历所有文件的覆盖率
      for (const [filePath, data] of Object.entries(coverageData)) {
        // 跳过非源文件
        if (!filePath.includes(sourceDir)) continue;

        const coveragePercent = data['lines']?.pct || 0;

        if (coveragePercent < minCoverage) {
          issues.push({
            module_path: filePath,
            issue_type: 'low_coverage',
            current_value: coveragePercent,
            target_value: minCoverage,
            severity: coveragePercent < 50 ? 'high' : 'medium'
          });
        }
      }

      console.log(`[CoverageScanner] Found ${issues.length} modules with low coverage`);
    } catch (error) {
      console.error('[CoverageScanner] Error parsing coverage report:', error.message);
    }

    return issues;
  }

  /**
   * 生成任务
   * @param {Object} issue 扫描发现的问题
   * @returns {Promise<Object>} 任务对象
   */
  async generateTask(issue) {
    const moduleName = path.basename(issue.module_path, '.js');
    const currentCoverage = Math.round(issue.current_value);
    const targetCoverage = issue.target_value;
    const gap = targetCoverage - currentCoverage;

    const description = [
      `代码覆盖率扫描发现 ${moduleName} 模块覆盖率不足，需要添加测试用例。`,
      ``,
      `文件路径：${issue.module_path}`,
      `当前覆盖率：${currentCoverage}%（目标：${targetCoverage}%，差距：${gap}%）`,
      ``,
      `建议操作：`,
      `1. 运行 npx vitest run --coverage 确认当前覆盖情况`,
      `2. 分析 ${moduleName} 的核心导出函数，针对每个函数添加测试用例`,
      `3. 重点覆盖分支路径（if/else）、错误处理（try/catch）和边界情况`,
      `4. 测试文件命名：${moduleName}.test.js，放在 src/__tests__/ 目录下`,
      ``,
      `验收标准：${moduleName} 模块行覆盖率达到 ${targetCoverage}% 及以上，npm test 全部通过。`,
    ].join('\n');

    return {
      title: `提高 ${moduleName} 模块覆盖率（当前 ${currentCoverage}% → 目标 ${targetCoverage}%）`,
      description,
      priority: issue.severity === 'high' ? 'P0' : 'P1',
      tags: ['quality', 'coverage', 'test'],
      metadata: {
        scanner: this.name,
        module_path: issue.module_path,
        current_value: issue.current_value,
        target_value: issue.target_value,
        issue_type: issue.issue_type
      }
    };
  }
}

export default CoverageScanner;
