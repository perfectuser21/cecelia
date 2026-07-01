/**
 * TDD Red — 无条件核心回归闸（B1）
 *
 * 验证三个文件的结构满足合同要求：
 *  1. regression-contract.yaml — 含 ≥1 条 P0+PR trigger 条目
 *  2. scripts/ci/run-core-regression.sh — 存在 + yq + exit 1 空守卫
 *  3. .github/workflows/ci.yml — core-regression job + 无路径门 + 删除 regression-smoke
 *
 * 当前状态（pre-implementation）：
 *  - regression-contract.yaml 的 entries 为空 → test 1 FAIL
 *  - scripts/ci/run-core-regression.sh 不存在 → test 2 FAIL
 *  - ci.yml 缺 core-regression job → test 3/4/5 FAIL
 *  合计预期 5 FAIL（Red 证据）
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

describe('core-regression 无条件闸 — CI 基础设施合同', () => {
  describe('regression-contract.yaml', () => {
    it('含 ≥1 条 priority=P0 + trigger=[...PR...] + test_command 非空的 entries', () => {
      const contractPath = join(REPO_ROOT, 'regression-contract.yaml');
      expect(existsSync(contractPath), 'regression-contract.yaml 不存在').toBe(true);
      const content = readFileSync(contractPath, 'utf8');
      // 必须有 entries 数组（非 `entries: []`）
      expect(content).toMatch(/entries:/);
      // P0 条目
      expect(content, '缺少 P0 优先级条目').toContain('P0');
      // PR trigger
      expect(content, '缺少 PR trigger').toMatch(/trigger.*PR|PR.*trigger/s);
      // test_command 非空
      expect(content, '缺少 test_command').toContain('test_command');
    });
  });

  describe('scripts/ci/run-core-regression.sh', () => {
    it('脚本文件存在', () => {
      const scriptPath = join(REPO_ROOT, 'scripts', 'ci', 'run-core-regression.sh');
      expect(existsSync(scriptPath), 'run-core-regression.sh 不存在').toBe(true);
    });

    it('脚本含 yq 调用', () => {
      const scriptPath = join(REPO_ROOT, 'scripts', 'ci', 'run-core-regression.sh');
      if (!existsSync(scriptPath)) return;
      const content = readFileSync(scriptPath, 'utf8');
      expect(content, '脚本缺 yq 调用').toContain('yq');
    });

    it('脚本含 exit 1 空集守卫（防退化假绿灯）', () => {
      const scriptPath = join(REPO_ROOT, 'scripts', 'ci', 'run-core-regression.sh');
      if (!existsSync(scriptPath)) return;
      const content = readFileSync(scriptPath, 'utf8');
      expect(content, '脚本缺 exit 1 守卫').toContain('exit 1');
    });

    it('脚本引用 regression-contract.yaml 或 CONTRACT_FILE', () => {
      const scriptPath = join(REPO_ROOT, 'scripts', 'ci', 'run-core-regression.sh');
      if (!existsSync(scriptPath)) return;
      const content = readFileSync(scriptPath, 'utf8');
      expect(content, '脚本缺 contract 文件引用').toMatch(
        /regression-contract\.yaml|CONTRACT_FILE/
      );
    });

    it('yq 解析格式错误 YAML 时 exit 非零（FROM_PRD 边界情况）', () => {
      const scriptPath = join(REPO_ROOT, 'scripts', 'ci', 'run-core-regression.sh');
      expect(existsSync(scriptPath), 'run-core-regression.sh 不存在').toBe(true);
      const tmpFile = join(tmpdir(), `bad-contract-${Date.now()}.yaml`);
      writeFileSync(tmpFile, 'version: [broken\nentries: {invalid_yaml');
      try {
        const result = spawnSync('bash', [scriptPath], {
          env: { ...process.env, TRIGGER_TYPE: 'PR', CONTRACT_FILE: tmpFile },
          stdio: 'pipe',
        });
        expect(result.status, 'yq 解析格式错误 YAML 应 exit 非零').not.toBe(0);
      } finally {
        unlinkSync(tmpFile);
      }
    });
  });

  describe('.github/workflows/ci.yml', () => {
    const ciPath = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
    let ciContent = '';

    it('ci.yml 文件存在', () => {
      expect(existsSync(ciPath)).toBe(true);
      ciContent = readFileSync(ciPath, 'utf8');
    });

    it('包含 core-regression job 定义', () => {
      const content = readFileSync(ciPath, 'utf8');
      expect(content, 'ci.yml 缺 core-regression job').toContain('core-regression:');
    });

    it('core-regression job 无路径门 if（不依赖 needs.changes.outputs）', () => {
      const content = readFileSync(ciPath, 'utf8');
      // 提取 core-regression 段落（到下一个顶层 job 为止）
      const jobMatch = content.match(/  core-regression:([\s\S]*?)(?=\n  [a-z][a-z-]*:|$)/);
      if (!jobMatch) return; // job 不存在时其他 it 已 FAIL
      const section = jobMatch[1];
      expect(
        section,
        'core-regression 含路径门 if: contains(needs.changes'
      ).not.toMatch(/if:.*contains\(needs\.changes/);
    });

    it('regression-smoke job 已删除（ci.yml 不含 regression-smoke:）', () => {
      const content = readFileSync(ciPath, 'utf8');
      expect(content, 'regression-smoke job 仍存在').not.toMatch(
        /^  regression-smoke:/m
      );
    });

    it('regression-smoke 扫 golden-smoke.test.ts 的逻辑已删除', () => {
      const content = readFileSync(ciPath, 'utf8');
      expect(content, 'golden-smoke.test.ts 扫描逻辑仍存在').not.toContain(
        'golden-smoke.test.ts'
      );
    });

    it('ci-passed needs 含 core-regression', () => {
      const content = readFileSync(ciPath, 'utf8');
      const needsMatch = content.match(/ci-passed:\s*\n\s+(?:if:[^\n]*\n\s+)?needs:\s*\[([^\]]+)\]/);
      const needsList = needsMatch?.[1] ?? '';
      expect(needsList, 'ci-passed needs 缺 core-regression').toContain('core-regression');
    });

    it('ci-passed needs 不含 regression-smoke', () => {
      const content = readFileSync(ciPath, 'utf8');
      const needsMatch = content.match(/ci-passed:\s*\n\s+(?:if:[^\n]*\n\s+)?needs:\s*\[([^\]]+)\]/);
      const needsList = needsMatch?.[1] ?? '';
      expect(needsList, 'ci-passed needs 仍含 regression-smoke').not.toContain(
        'regression-smoke'
      );
    });

    it('ci-passed run 块不含 check "regression-smoke"（两处引用均清除）', () => {
      const content = readFileSync(ciPath, 'utf8');
      expect(content, 'ci-passed run 块仍含 check "regression-smoke"').not.toContain(
        'check "regression-smoke"'
      );
    });

    it('ci-passed run 块含 check "core-regression"', () => {
      const content = readFileSync(ciPath, 'utf8');
      expect(content, 'ci-passed run 块缺 check "core-regression"').toContain(
        'check "core-regression"'
      );
    });
  });
});
