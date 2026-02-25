#!/usr/bin/env node
/**
 * Detect Forbidden
 *
 * 检测禁止修改的区域（基于常见规则）
 */

const forbiddenPatterns = [
  {
    pattern: /node_modules\//,
    reason: 'Never modify node_modules directly'
  },
  {
    pattern: /\.git\//,
    reason: 'Git internal files'
  },
  {
    pattern: /package-lock\.json$/,
    reason: 'Auto-generated, should not be manually edited'
  },
  {
    pattern: /dist\//,
    reason: 'Build output, auto-generated'
  },
  {
    pattern: /\.env$/,
    reason: 'Environment secrets, should not be committed'
  }
];

function main() {
  const output = {
    forbidden: forbiddenPatterns.map(p => ({
      pattern: p.pattern.toString(),
      reason: p.reason
    })),
    recommendation: 'Add custom forbidden patterns based on project requirements'
  };

  console.log(JSON.stringify(output, null, 2));
}

main();
