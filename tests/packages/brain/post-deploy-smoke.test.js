/**
 * Unit test for cicd-C：brain-deploy.sh 的通用 post-deploy smoke 阶段。
 *
 * 范畴：纯文件结构校验，不证明真实生产业务完成。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// __dirname = tests/packages/brain → 上 3 层到 repo root
const REPO_ROOT = resolve(__dirname, '../../..');
const DEPLOY_SH = resolve(REPO_ROOT, 'scripts/brain-deploy.sh');
const POST_DEPLOY_SH = resolve(REPO_ROOT, 'scripts/lib/brain-post-deploy.sh');

describe('post-deploy smoke contract', () => {
  it('入口source的真实收尾helper包含smoke函数', () => {
    const txt = readFileSync(POST_DEPLOY_SH, 'utf8');
    expect(txt).toMatch(/^run_post_deploy_smoke\(\) \{/m);
    // 必须支持 SKIP env + RECENT_PRS env（mock / 紧急部署）
    expect(txt).toContain('SKIP_POST_DEPLOY_SMOKE');
    expect(txt).toContain('RECENT_PRS');
    // 调用 gh pr view 取 PR 引入的 smoke 文件路径
    expect(txt).toContain('gh pr view');
    expect(txt).toContain('packages/brain/scripts/smoke/');
  });

  it('入口完成manifest验真后才调用宿主收尾，收尾沿用non-fatal smoke', () => {
    const entry = readFileSync(DEPLOY_SH, 'utf8'), helper=readFileSync(POST_DEPLOY_SH,'utf8');
    expect(entry).toContain('source "$SCRIPT_DIR/lib/brain-post-deploy.sh"');
    const healthy=entry.indexOf('echo "Waiting for health check..."');
    const verified=entry.indexOf('    activate_cecelia_map_manifest',healthy);
    const completion=entry.indexOf('    complete_verified_host_release',verified);
    expect(healthy).toBeGreaterThan(0);expect(verified).toBeGreaterThan(healthy);expect(completion).toBeGreaterThan(verified);
    expect(helper).toMatch(/run_post_deploy_smoke[^\n]*\|\| true/);
  });
});
