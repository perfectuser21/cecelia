// F1 正规仓库路由 → Kernel 工作区装配：真实模块联用，保留来源身份。
import { expect, it } from 'vitest';
import { routeWork } from '../../../packages/brain/src/work-router.js';
import { createWorkspaceSpecResolver } from '../../../packages/brain/src/orchestrator/workspace-spec.js';

it('canonical ZenithJoy hotfix routing materializes the same repository without a legacy alias', async () => {
  const route = routeWork({
    source: 'api', source_id: 'canonical-workspace-flow-regression', title: '修复获客来源',
    mutation_intent: 'write', declared_change_kind: 'bugfix', artifact_kind: 'code',
    repo_hint: 'zenithjoy-workspace', map_scope_hint: ['keyword_acquisition'],
  }, [{ repo: 'zenithjoy-workspace' }]);
  expect(route).toMatchObject({ repo: 'zenithjoy-workspace', canonical_task_type: 'harness_initiative' });
  const base = '0123456789abcdef0123456789abcdef01234567';
  const spec = await createWorkspaceSpecResolver({ resolveRepoHead: async () => base })({
    action: 'spawn:generator', role: 'generator', readOnly: false,
    attemptId: '22222222-2222-4222-8222-222222222222',
    ctx: { runId: '11111111-1111-4111-8111-111111111111', observed: { task: {
      payload: { repo: route.repo, base_sha: base, branch: 'cp-regression-canonical-repo' },
    } } },
    bundle: { inputs: {} },
  });
  expect(spec).toMatchObject({ repo: 'perfectuser21/zenithjoy-workspace', base_sha: base,
    branch: 'cp-regression-canonical-repo', frozen_baseline: true });
});
