/**
 * fr03-brain-deploy-endpoint.test.js
 * 验证 FR-03：Brain deploy/dev 端点存在（静态存在性合同）
 * 毕业自 sprints/07131922-环境模型三段常驻收尾-cecelia-zenithjoy-4e5fd7eb/tests/
 * （刀1 测试入册：原为裸 node 脚本 + process.exit，vitest 化后进 brain vitest 跑道；
 *  原 T05 在线端点验证依赖活 Brain 5221，属 smoke 层，见
 *  scripts/smoke/e2e/env-model-cecelia-zenithjoy-4e5fd7eb.sh）
 * task_id: d063b3e5-8fb1-4d53-b176-8e8198c7a084
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../..');
const BRAIN_SRC = path.join(ROOT_DIR, 'packages/brain/src');

function grepBrainSrc(pattern, extra = '') {
  try {
    return execSync(
      `grep -rn "${pattern}" "${BRAIN_SRC}" --include="*.js" | grep -v "__tests__" ${extra} | head -10`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
  } catch {
    return '';
  }
}

describe('FR-03: Brain deploy/dev 端点核验 [BEHAVIOR]', () => {
  it('T01: Brain src 中存在 deploy dev 端点定义', () => {
    const result = grepBrainSrc('deploy.*dev\\|dev.*deploy\\|POST.*deploy', '| grep -v ".test."');
    expect(result.length, '未找到 POST /api/brain/deploy {dev:true} 端点定义').toBeGreaterThan(0);
  });

  it('T02: 存在 /api/brain/deploy/dev/status 查询端点', () => {
    const result = grepBrainSrc('deploy/dev/status\\|deploy.*dev.*status');
    expect(result.length, '未找到 GET /api/brain/deploy/dev/status 端点定义').toBeGreaterThan(0);
  });

  it('T03: 存在覆盖 deploy dev 的单元测试', () => {
    const testsDir = path.join(BRAIN_SRC, '__tests__');
    expect(existsSync(testsDir), `__tests__ 目录不存在: ${testsDir}`).toBe(true);
    const testFiles = execSync(
      `find "${testsDir}" -name "*.test.*" | xargs grep -l "deploy.*dev\\|dev.*deploy" 2>/dev/null || echo ""`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    expect(testFiles.length, '未找到覆盖 POST /api/brain/deploy {dev:true} 的单元测试').toBeGreaterThan(0);
  });
});
