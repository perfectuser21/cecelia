/**
 * Unit test for cicd-C：brain-deploy.sh 的 post-deploy smoke 阶段 + c8a smoke 范本。
 *
 * 范畴：纯文件结构 / 关键不变量校验。真实环境跑 smoke 由 CI 的 real-env-smoke job
 * (cicd-B) 覆盖；本测试只确保两份脚本文件存在且含必要 contract。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

// __dirname = tests/packages/brain → 上 3 层到 repo root
const REPO_ROOT = resolve(__dirname, '../../..');
const DEPLOY_SH = resolve(REPO_ROOT, 'scripts/brain-deploy.sh');
const C8A_SMOKE = resolve(REPO_ROOT, 'packages/brain/scripts/smoke/c8a-harness-checkpoint-resume.sh');

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

  it('c8a smoke 脚本存在且可执行', () => {
    const st = statSync(C8A_SMOKE);
    // owner execute bit
    // eslint-disable-next-line no-bitwise
    expect((st.mode & 0o100) !== 0).toBe(true);
  });

  it('c8a smoke 含 7 步关键验证（PRD task #3）', () => {
    const txt = readFileSync(C8A_SMOKE, 'utf8');
    // PostgresSaver round-trip：put + getTuple
    expect(txt).toContain('PostgresSaver');
    expect(txt).toContain('saver.put');
    expect(txt).toContain('saver.getTuple');
    // 5 节点 / 5 channel
    expect(txt).toContain('5_checkpoints_written');
    expect(txt).toContain('5_channels_recovered');
    // 5 channel 名字（与 InitiativeState Annotation.Root 一一对应）
    for (const ch of ['worktreePath', 'plannerOutput', 'taskPlan', 'ganResult', 'result']) {
      expect(txt).toContain(ch);
    }
    // 跨 Brain 重启验持久
    expect(txt).toContain('docker restart cecelia-node-brain');
    expect(txt).toContain('checkpoints rows after restart');
    // 健康检查等 Brain 重启完
    expect(txt).toContain('/api/brain/tick/status');
    // cleanup 不留垃圾行（trap EXIT 删 thread_id 对应的全部 checkpoint*）
    expect(txt).toContain('trap cleanup EXIT');
    expect(txt).toMatch(/DELETE FROM checkpoints WHERE thread_id/);
    expect(txt).toMatch(/DELETE FROM checkpoint_blobs WHERE thread_id/);
    expect(txt).toMatch(/DELETE FROM checkpoint_writes WHERE thread_id/);
  });

  it('c8a smoke 在缺前置依赖时优雅 skip（exit 0）', () => {
    const txt = readFileSync(C8A_SMOKE, 'utf8');
    expect(txt).toContain('skip()');
    // skip 走的 4 个 gate
    expect(txt).toContain('docker 命令不存在');
    expect(txt).toContain('docker daemon 不可达');
    expect(txt).toContain('cecelia-node-brain 容器不存在');
    expect(txt).toContain('psql 不在 PATH');
  });
});
