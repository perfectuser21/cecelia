#!/usr/bin/env node
/**
 * Risk Score Calculator
 *
 * 计算代码变更的风险分数，决定是否需要执行 QA Node
 *
 * Usage:
 *   node scripts/qa/risk-score.js [--base <branch>] [--head <commit>]
 *
 * Output (JSON):
 *   {
 *     "riskScore": 4,
 *     "rules": ["R1", "R3", "R5"],
 *     "requiresQA": true,
 *     "details": {
 *       "R1": "Changed public API: src/api/index.ts",
 *       "R3": "Cross-module changes: skills/, scripts/",
 *       "R5": "Security related: .env, token usage"
 *     }
 *   }
 */

const { execSync } = require('child_process');
const { DEFAULT_BASE_BRANCH, DEFAULT_HEAD_REF } = require('../lib/constants.cjs');

// 解析命令行参数
const args = process.argv.slice(2);
let base = DEFAULT_BASE_BRANCH;
let head = DEFAULT_HEAD_REF;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--base' && args[i + 1]) {
    base = args[i + 1];
    i++;
  } else if (args[i] === '--head' && args[i + 1]) {
    head = args[i + 1];
    i++;
  }
}

// 获取变更文件列表
function getChangedFiles() {
  try {
    const diff = execSync(`git diff --name-only ${base}...${head}`, { encoding: 'utf-8' });
    return diff.split('\n').filter(Boolean);
  } catch (error) {
    console.error('Error getting changed files:', error.message);
    process.exit(1);
  }
}

// 获取文件内容变更
function getFileDiff(file) {
  try {
    return execSync(`git diff ${base}...${head} -- "${file}"`, { encoding: 'utf-8' });
  } catch (error) {
    return '';
  }
}

// R1-R8 规则定义
const rules = {
  R1: {
    name: 'Public API Changes',
    check: (files, diffs) => {
      const apiPatterns = [
        /\/(api|sdk|cli)\//,
        /\/index\.(ts|js)$/,
        /\/public\//,
        /exports?\s+(class|function|const|interface)/
      ];

      const matches = [];
      for (const file of files) {
        if (apiPatterns.some(p => p.test(file))) {
          matches.push(file);
        }
      }

      return {
        triggered: matches.length > 0,
        details: matches.length > 0 ? `Changed public API: ${matches.join(', ')}` : null
      };
    }
  },

  R2: {
    name: 'Data Model Changes',
    check: (files) => {
      const dataPatterns = [
        /schema/i,
        /state\.json/,
        /summary\.json/,
        /\.ya?ml$/,
        /migration/i,
        /database/i
      ];

      const matches = files.filter(f => dataPatterns.some(p => p.test(f)));
      return {
        triggered: matches.length > 0,
        details: matches.length > 0 ? `Data model changes: ${matches.join(', ')}` : null
      };
    }
  },

  R3: {
    name: 'Cross-Module Changes',
    check: (files) => {
      const modules = new Set();
      for (const file of files) {
        const parts = file.split('/');
        if (parts.length > 0) {
          modules.add(parts[0]);
        }
      }

      return {
        triggered: modules.size >= 2,
        details: modules.size >= 2 ? `Cross-module changes: ${Array.from(modules).join(', ')}` : null
      };
    }
  },

  R4: {
    name: 'New Dependencies',
    check: (files, diffs) => {
      const matches = [];

      if (files.includes('package.json') && diffs['package.json']) {
        const diff = diffs['package.json'];
        if (/^\+.*"dependencies"|"devDependencies"/.test(diff)) {
          matches.push('package.json');
        }
      }

      return {
        triggered: matches.length > 0,
        details: matches.length > 0 ? `New dependencies: ${matches.join(', ')}` : null
      };
    }
  },

  R5: {
    name: 'Security/Permissions',
    check: (files, diffs) => {
      const securityPatterns = [
        /token/i,
        /secret/i,
        /\.env/,
        /password/i,
        /credential/i,
        /exec\(/,
        /spawn\(/,
        /fs\./,
        /readFile|writeFile/
      ];

      const matches = [];

      for (const file of files) {
        if (securityPatterns.some(p => p.test(file))) {
          matches.push(file);
        }
      }

      for (const [file, diff] of Object.entries(diffs)) {
        if (securityPatterns.some(p => p.test(diff))) {
          if (!matches.includes(file)) {
            matches.push(file);
          }
        }
      }

      return {
        triggered: matches.length > 0,
        details: matches.length > 0 ? `Security related: ${matches.slice(0, 3).join(', ')}` : null
      };
    }
  },

  R6: {
    name: 'Core Workflow Changes',
    check: (files) => {
      const corePatterns = [
        /skills\/dev\//,
        /skills\/audit\//,
        /skills\/qa\//,
        /hooks\//,
        /pr-gate/,
        /ci-gate/,
        /track\.sh/
      ];

      const matches = files.filter(f => corePatterns.some(p => p.test(f)));
      return {
        triggered: matches.length > 0,
        details: matches.length > 0 ? `Core workflow: ${matches.join(', ')}` : null
      };
    }
  },

  R7: {
    name: 'Default Behavior Changes',
    check: (files, diffs) => {
      const behaviorPatterns = [
        /featureFlag/i,
        /defaultValue/i,
        /fallback/i,
        /config/i,
        /settings/i
      ];

      const matches = [];

      for (const [file, diff] of Object.entries(diffs)) {
        if (behaviorPatterns.some(p => p.test(diff))) {
          matches.push(file);
        }
      }

      return {
        triggered: matches.length > 0,
        details: matches.length > 0 ? `Default behavior: ${matches.join(', ')}` : null
      };
    }
  },

  R8: {
    name: 'Financial/Billing',
    check: (files, diffs) => {
      const financialPatterns = [
        /payment/i,
        /billing/i,
        /amount/i,
        /price/i,
        /cost/i,
        /invoice/i,
        /transaction/i
      ];

      const matches = [];

      for (const file of files) {
        if (financialPatterns.some(p => p.test(file))) {
          matches.push(file);
        }
      }

      return {
        triggered: matches.length > 0,
        details: matches.length > 0 ? `Financial: ${matches.join(', ')}` : null
      };
    }
  }
};

// 主函数
function main() {
  const files = getChangedFiles();

  if (files.length === 0) {
    console.log(JSON.stringify({
      riskScore: 0,
      rules: [],
      requiresQA: false,
      details: {},
      message: 'No files changed'
    }, null, 2));
    return;
  }

  // 获取文件 diff
  const diffs = {};
  for (const file of files) {
    diffs[file] = getFileDiff(file);
  }

  // 执行规则检查
  let score = 0;
  const triggered = [];
  const details = {};

  for (const [id, rule] of Object.entries(rules)) {
    const result = rule.check(files, diffs);
    if (result.triggered) {
      score++;
      triggered.push(id);
      if (result.details) {
        details[id] = result.details;
      }
    }
  }

  // 输出结果
  const output = {
    riskScore: score,
    rules: triggered,
    requiresQA: score >= 3,
    details,
    summary: {
      filesChanged: files.length,
      threshold: 3,
      recommendation: score >= 3 ? 'QA Decision Node is REQUIRED' : 'QA Decision Node is OPTIONAL'
    }
  };

  console.log(JSON.stringify(output, null, 2));
  process.exit(score >= 3 ? 1 : 0);
}

main();
