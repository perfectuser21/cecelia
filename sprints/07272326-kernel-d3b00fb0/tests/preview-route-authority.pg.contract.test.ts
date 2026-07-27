import { describe, expect, it } from 'vitest';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe('preview route authority PostgreSQL contract [BEHAVIOR]', () => {
  it('TEST_DATABASE_URL safety gate', () => {
    expect(TEST_DATABASE_URL, '必须显式设置 TEST_DATABASE_URL；禁止 fallback').toBeTruthy();
  });

  it('preview route 只把 caller 字段当 identifier claim 并写 authority-bound receipt', () => {
    expect.fail('待实现: 真 route→isolated PG→GitHub PR #4372 head/draft→decision log identity/SHA 对账');
  });

  it('stable blocker: stale_check_sha', () => {
    expect.fail('待实现: 旧 SHA 收据必须独立返回 stale_check_sha，当前 head 正例单独通过');
  });

  it('stable blocker: wrong_repo', () => {
    expect.fail('待实现: wrong_repo 独立失败，禁止与其他 blocker OR 合并');
  });

  it('stable blocker: wrong_run_task', () => {
    expect.fail('待实现: wrong_run_task 独立失败并绑定 run/task/current SHA');
  });

  it('stable blocker: missing_required_context', () => {
    expect.fail('待实现: 缺 context 必须独立 stable reason');
  });

  it('stable blocker: preview_required_failure', () => {
    expect.fail('待实现: preview required context fail 必须独立 stable reason');
  });

  it('stable blocker: local_required_context_failure', () => {
    expect.fail('待实现: local required context fail 必须独立 stable reason');
  });

  it('stable blocker: missing_context_mapping', () => {
    expect.fail('待实现: 本地 context 映射缺失必须独立 stable reason');
  });

  it('stable blocker: external_infrastructure_failure', () => {
    expect.fail('待实现: GitHub/infra 读取失败必须独立 stable reason，且不写 allow');
  });

  it('generator-fix uses the real preview seam', () => {
    expect.fail('待实现: generator-fix 必须走真实 preview route/current SHA gate，而不是 helper existence');
  });

  it('legacy adapter 原路径保持原 pass/fail 语义', () => {
    expect.fail('待实现: 直接调用 legacy adapter 原入口并验证记录隔离');
  });

  it('postmerge staging', () => {
    expect.fail('待实现: staging 必须是独立 record，并独立终态/SHA 校验');
  });

  it('production promotion', () => {
    expect.fail('待实现: production promotion 必须是独立 record，并独立终态/SHA 校验');
  });

  it('final report', () => {
    expect.fail('待实现: final report 必须是独立 record，并独立终态/SHA 校验');
  });

  it('零生产 mutation', () => {
    expect.fail('待实现: contract/evaluator 阶段 merge/deploy/approval POST 全为 0，只读已种下授权记录');
  });
});

