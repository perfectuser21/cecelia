/**
 * 未测试模块检测器
 * 扫描缺少测试文件的源代码模块
 */
import BaseScanner from './base-scanner.js';
import fs from 'fs';
import path from 'path';

class UntestedScanner extends BaseScanner {
  constructor(options = {}) {
    super('untested', {
      sourceDir: options.sourceDir || './packages/brain/src',
      testDir: options.testDir || './packages/brain/src/__tests__',
      excludeDirs: options.excludeDirs || ['node_modules', '__tests__', 'migrations', 'scripts', 'prompts']
    });
  }

  /**
   * 执行扫描
   * @returns {Promise<Array>} 未测试模块列表
   */
  async scan() {
    const issues = [];
    const { sourceDir, testDir, excludeDirs } = this.options;

    const sourcePath = path.resolve(sourceDir);
    const testPath = path.resolve(testDir);

    if (!fs.existsSync(sourcePath)) {
      console.log('[UntestedScanner] Source directory not found, skipping scan');
      return issues;
    }

    // 收集所有测试文件路径（用于匹配）
    const testFiles = new Set();
    if (fs.existsSync(testPath)) {
      this.walkDir(testPath, []).forEach(f => {
        if (f.endsWith('.test.js') || f.endsWith('.spec.js')) {
          // 提取模块名
          const baseName = path.basename(f, path.extname(f))
            .replace('.test', '')
            .replace('.spec', '');
          testFiles.add(baseName);
        }
      });
    }

    // 遍历源文件目录
    const sourceFiles = this.walkDir(sourcePath, excludeDirs);

    for (const filePath of sourceFiles) {
      if (!filePath.endsWith('.js')) continue;

      // 跳过测试文件本身
      if (filePath.includes('__tests__') || filePath.includes('.test.js') || filePath.includes('.spec.js')) {
        continue;
      }

      const relativePath = path.relative(process.cwd(), filePath);
      const moduleName = path.basename(filePath, '.js');

      // 检查是否有对应的测试文件
      // 可能的测试文件位置：
      // 1. 同目录: moduleName.test.js
      // 2. __tests__ 目录: moduleName.test.js
      // 3. tests 目录: moduleName.test.js

      const hasTest = testFiles.has(moduleName) ||
        fs.existsSync(path.join(path.dirname(filePath), `${moduleName}.test.js`)) ||
        fs.existsSync(path.join(path.dirname(filePath), `${moduleName}.spec.js`)) ||
        fs.existsSync(path.join(path.dirname(filePath), '__tests__', `${moduleName}.test.js`)) ||
        fs.existsSync(path.join(path.dirname(filePath), 'tests', `${moduleName}.test.js`));

      if (!hasTest) {
        // 检查是否是需要测试的关键业务模块
        const isKeyModule = this.isKeyModule(filePath);

        issues.push({
          module_path: relativePath,
          issue_type: 'no_test',
          current_value: 0,
          target_value: 1,
          severity: isKeyModule ? 'high' : 'low'
        });
      }
    }

    console.log(`[UntestedScanner] Found ${issues.length} modules without tests`);
    return issues;
  }

  /**
   * 遍历目录获取所有文件
   */
  walkDir(dir, excludeDirs) {
    const files = [];

    if (!fs.existsSync(dir)) return files;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!excludeDirs.includes(entry.name) && !entry.name.startsWith('.')) {
            files.push(...this.walkDir(fullPath, excludeDirs));
          }
        } else {
          files.push(fullPath);
        }
      }
    } catch (error) {
      console.error(`[UntestedScanner] Error reading directory ${dir}:`, error.message);
    }

    return files;
  }

  /**
   * 判断是否为关键业务模块
   */
  isKeyModule(filePath) {
    const keyPatterns = [
      /\/brain\/src\/(executor|decision|task-router|dispatcher)/,
      /\/brain\/src\/(cortex|thalamus|planner)/,
      /\/brain\/src\/(tick|orchestrator)/
    ];

    return keyPatterns.some(pattern => pattern.test(filePath));
  }

  /**
   * 生成任务
   * @param {Object} issue 扫描发现的问题
   * @returns {Promise<Object>} 任务对象
   */
  async generateTask(issue) {
    const moduleName = path.basename(issue.module_path, '.js');
    const testFileName = `${moduleName}.test.js`;
    const severityText = issue.severity === 'high' ? '高（关键业务模块，影响调度/决策/执行）' : '低（辅助模块）';

    const description = [
      `未测试模块检测发现 ${moduleName} 缺少对应测试文件，需要创建测试以保障代码质量。`,
      ``,
      `模块路径：${issue.module_path}`,
      `严重程度：${severityText}`,
      ``,
      `建议实现：`,
      `1. 分析模块导出：识别 ${moduleName} 的关键导出函数/类及其参数签名`,
      `2. 创建测试文件：${testFileName}（放在 src/__tests__/ 目录下）`,
      `3. 覆盖核心功能：至少验证主要导出函数的正常路径和边界情况`,
      `4. 使用 vi.mock() 隔离外部依赖（DB、文件系统、网络请求）`,
      ``,
      `验收标准：${testFileName} 存在且 npm test 通过，${moduleName} 行覆盖率达到 70% 以上。`,
    ].join('\n');

    return {
      title: `为 ${moduleName} 模块添加单元测试（${issue.severity === 'high' ? 'P0 关键模块' : 'P2 辅助模块'}）`,
      description,
      priority: issue.severity === 'high' ? 'P0' : 'P2',
      tags: ['quality', 'test', 'untested'],
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

export default UntestedScanner;
