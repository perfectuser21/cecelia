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

    return {
      title: `为 ${moduleName} 模块添加测试`,
      description: `未测试模块检测发现：${issue.module_path}\n\n当前状态: 无测试文件\n目标: 至少有一个测试文件\n\n严重程度: ${issue.severity === 'high' ? '高（关键业务模块）' : '低'}\n\n请为该模块添加单元测试。`,
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
