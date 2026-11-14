/**
 * Unit test for cicd-C：brain-deploy.sh 的通用 post-deploy smoke 阶段。
 *
 * 范畴：纯文件结构 / 关键不变量校验。真实环境跑 smoke 由 CI 的 real-env-smoke job
 * (cicd-B) 覆盖；本测试保留部署完成后的通用冒烟入口合同。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// __dirname = tests/packages/brain → 上 3 层到 repo root
const REPO_ROOT = resolve(__dirname, '../../..');
const DEPLOY_SH = resolve(REPO_ROOT, 'scripts/brain-deploy.sh');

describe('post-deploy smoke contract', () => {
  it('brain-deploy.sh 含 run_post_deploy_smoke 函数定义', () => {
    const txt = readFileSync(DEPLOY_SH, 'utf8');
    expect(txt).toMatch(/^run_post_deploy_smoke\(\) \{/m);
    // 必须支持 SKIP env + RECENT_PRS env（mock / 紧急部署）
    expect(txt).toContain('SKIP_POST_DEPLOY_SMOKE');
    expect(txt).toContain('RECENT_PRS');
    // 调用 gh pr view 取 PR 引入的 smoke 文件路径
    expect(txt).toContain('gh pr view');
    expect(txt).toContain('packages/brain/scripts/smoke/');
  });

  it('brain-deploy.sh healthy check 后调 run_post_deploy_smoke', () => {
    const txt = readFileSync(DEPLOY_SH, 'utf8');
    expect(txt).toMatch(/\[11\/11\] Post-deploy smoke/);
    expect(txt).toContain('run_post_deploy_smoke');
    // smoke non-fatal — deploy 已成功不能因 smoke 回滚
    expect(txt).toMatch(/run_post_deploy_smoke[^\n]*\|\| true/);
  });

});
