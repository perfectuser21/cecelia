/**
 * 代码复杂度扫描器
 * 识别圈复杂度过高的函数
 */
import BaseScanner from './base-scanner.js';
import fs from 'fs';
import path from 'path';

class ComplexityScanner extends BaseScanner {
  constructor(options = {}) {
    super('complexity', {
      threshold: {
        maxCyclomatic: options.maxCyclomatic || 10, // 默认圈复杂度 > 10
        ...options.threshold
      },
      sourceDir: options.sourceDir || './packages/brain/src',
      excludeDirs: options.excludeDirs || ['node_modules', '__tests__', 'migrations']
    });
  }

  /**
   * 执行扫描
   * @returns {Promise<Array>} 复杂度问题列表
   */
  async scan() {
    const issues = [];
    const { sourceDir, excludeDirs, threshold } = this.options;
    const maxCyclomatic = threshold.maxCyclomatic;

    const sourcePath = path.resolve(sourceDir);
    if (!fs.existsSync(sourcePath)) {
      console.log('[ComplexityScanner] Source directory not found, skipping scan');
      return issues;
    }

    // 遍历所有 JS 文件
    const files = this.walkDir(sourcePath, excludeDirs);

    for (const filePath of files) {
      if (!filePath.endsWith('.js')) continue;

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const functions = this.analyzeComplexity(content);

        for (const func of functions) {
          if (func.cyclomatic > maxCyclomatic) {
            issues.push({
              module_path: path.relative(process.cwd(), filePath),
              issue_type: 'high_complexity',
              current_value: func.cyclomatic,
              target_value: maxCyclomatic,
              function_name: func.name,
              line_number: func.line,
              severity: func.cyclomatic > 20 ? 'high' : 'medium'
            });
          }
        }
      } catch (error) {
        console.error(`[ComplexityScanner] Error analyzing ${filePath}:`, error.message);
      }
    }

    console.log(`[ComplexityScanner] Found ${issues.length} functions with high complexity`);
    return issues;
  }

  /**
   * 遍历目录获取所有文件
   */
  walkDir(dir, excludeDirs) {
    const files = [];

    if (!fs.existsSync(dir)) return files;

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

    return files;
  }

  /**
   * 分析代码复杂度
   * 简单分析：统计分支语句数量（if, while, for, case, &&, ||, ?:）
   */
  analyzeComplexity(content) {
    const functions = [];

    // 匹配函数声明：function name() {} 或 const name = () => {}
    const functionRegex = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(|(\w+)\s*:\s*function)/g;

    let match;
    while ((match = functionRegex.exec(content)) !== null) {
      const funcName = match[1] || match[2] || match[3];
      if (!funcName || funcName === 'function') continue;

      // 简单估算：从函数开始到结束，计算分支数量
      const funcStart = match.index;
      // 找到函数体结束位置（简化处理：找对应的闭合大括号）
      const braceStart = content.indexOf('{', funcStart);
      if (braceStart === -1) continue;

      // 用大括号配对找到函数体的实际结束位置
      let depth = 0;
      let braceEnd = braceStart;
      for (let i = braceStart; i < content.length; i++) {
        if (content[i] === '{') depth++;
        else if (content[i] === '}') {
          depth--;
          if (depth === 0) { braceEnd = i + 1; break; }
        }
      }
      const funcBody = content.slice(braceStart, braceEnd);
      const branchCount = this.countBranches(funcBody);

      functions.push({
        name: funcName,
        cyclomatic: branchCount + 1,
        line: this.countLines(content.slice(0, funcStart))
      });
    }

    return functions;
  }

  /**
   * 统计分支语句数量
   */
  countBranches(body) {
    const branches = [
      /\bif\b/g,
      /\bwhile\b/g,
      /\bfor\b/g,
      /\bswitch\b/g,
      /\bcase\b/g,
      /\bcatch\b/g,
      /&&/g,
      /\|\|/g,
      /\?[^:]+:/g // 三元运算符
    ];

    let count = 0;
    for (const regex of branches) {
      const matches = body.match(regex);
      if (matches) count += matches.length;
    }

    return count;
  }

  /**
   * 统计行数
   */
  countLines(text) {
    return text.split('\n').length;
  }

  /**
   * 生成任务
   * @param {Object} issue 扫描发现的问题
   * @returns {Promise<Object>} 任务对象
   */
  async generateTask(issue) {
    const moduleName = path.basename(issue.module_path, '.js');

    const description = [
      `代码复杂度扫描发现 ${moduleName} 中的 ${issue.function_name} 函数圈复杂度过高，需要重构以降低复杂度。`,
      ``,
      `文件：${issue.module_path}（第 ${issue.line_number} 行）`,
      `函数名：${issue.function_name}`,
      `当前圈复杂度：${issue.current_value}（阈值：${issue.target_value}）`,
      ``,
      `重构建议：`,
      `1. 提取子函数：将复杂条件分支拆分为独立的命名函数`,
      `2. 简化条件：合并相似条件逻辑，使用早返回（early return）减少嵌套`,
      `3. 拆分模块：若函数职责混杂，考虑拆分为独立模块或类`,
      ``,
      `验收标准：${issue.function_name} 函数圈复杂度降至 ${issue.target_value} 以下，修改后 npm test 全部通过。`,
    ].join('\n');

    return {
      title: `重构 ${moduleName}.${issue.function_name}（复杂度 ${issue.current_value} → ${issue.target_value}）`,
      description,
      priority: issue.severity === 'high' ? 'P0' : 'P1',
      tags: ['quality', 'complexity', 'refactor'],
      metadata: {
        scanner: this.name,
        module_path: issue.module_path,
        current_value: issue.current_value,
        target_value: issue.target_value,
        issue_type: issue.issue_type,
        function_name: issue.function_name,
        line_number: issue.line_number
      }
    };
  }
}

export default ComplexityScanner;
