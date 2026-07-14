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
import { readFileSync, existsSync } from 'node:fs';
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

  it('T04: auto-dev-deploy.yml 存在且配置齐全（develop 触发/串行 concurrency/不取消在途/超时限制）', () => {
    const workflowPath = path.join(ROOT_DIR, '.github/workflows/auto-dev-deploy.yml');
    expect(existsSync(workflowPath), '.github/workflows/auto-dev-deploy.yml 不存在（FR-03 未实施）').toBe(true);
    const content = readFileSync(workflowPath, 'utf-8');
    expect(content, 'T04a: workflow 缺少 develop 分支触发条件').toContain('develop');
    expect(content, 'T04b: 缺少 concurrency group=deploy-environment').toContain('deploy-environment');
    expect(content, 'T04c: 缺少 cancel-in-progress: false').toContain('cancel-in-progress: false');
    expect(content, 'T04d: 缺少 timeout-minutes 配置').toContain('timeout-minutes');
  });
});
