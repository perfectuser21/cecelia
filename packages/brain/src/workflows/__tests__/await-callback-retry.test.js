import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('B18: awaitCallback exit≠0 不设 error 走 ci_fail', () => {
  const src = readFileSync(
    resolve(__dirname, '../harness-task.graph.js'),
    'utf8'
  );

  it('awaitCallback 处理 exit_code≠0 不再设 state.error', () => {
    // 不应再含老路径 'error: { node:"await_callback", message: \`container exit_code=' 模式
    expect(src).not.toMatch(/error:\s*\{\s*node:\s*['"]await_callback['"]/);
  });

  it('awaitCallback exit≠0 改设 ci_status=fail + ci_fail_type=container_exit', () => {
    expect(src).toMatch(/ci_fail_type:\s*['"]container_exit['"]/);
  });

  it('routeAfterFix 不再 cap fix_round (W用户决定不设硬上限)', () => {
    expect(src).not.toMatch(/fix_round\s*>\s*MAX_FIX_ROUNDS/);
  });

  it('harness-generator/SKILL.md 含 GREEN 前真验 manual:bash 规则', () => {
    const skillSrc = readFileSync(
      resolve(__dirname, '../../../../../packages/workflows/skills/harness-generator/SKILL.md'),
      'utf8'
    );
    expect(skillSrc).toMatch(/all_behaviors_passed|GREEN.*真验.*manual:bash|GREEN.*前.*合同.*manual/i);
  });
});
