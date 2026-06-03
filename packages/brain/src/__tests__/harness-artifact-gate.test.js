/**
 * harness-artifact-gate.test.js
 *
 * Fidelity-gate 失守回归测试（run 926779b5 / PR #3276 实证）：
 * generator 只写 Red 测试没实现路由（harness.js 无 /healthz），但 Final E2E PASS + PR merged。
 * 根因：pre-merge evaluator 是 LLM agent，打活 brain（跑 main、且重部署中不可达），
 * 结构上验不了 PR 分支新路由还 hand-wave PASS；brain 侧没有任何确定性 ARTIFACT 检查。
 *
 * 修法：evaluateContractNode 加确定性 brain 侧 ARTIFACT 门——checkout PR 分支跑 contract-dod.md
 * 的 [ARTIFACT] Test 命令，任一失败强制 verdict=FAIL，无视 LLM verdict。
 *
 * 本测试守护 3 个不变量：
 *   1. extractArtifactTests 只取 [ARTIFACT] 的 Test 命令（不混入 [BEHAVIOR]）
 *   2. runArtifactGate：任一命令非零退出 → ok=false（fail-loud）
 *   3. evaluateContractNode：ARTIFACT 门 ran && !ok → 强制返回 verdict=FAIL，且不 spawn LLM evaluator
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPoolQuery = vi.hoisted(() => vi.fn(async () => ({ rows: [] })));
vi.mock('../db.js', () => ({ default: { query: mockPoolQuery } }));

let mod;
beforeEach(async () => {
  vi.resetModules();
  mockPoolQuery.mockClear();
  mod = await import('../workflows/harness-task.graph.js');
});

describe('extractArtifactTests', () => {
  const CONTRACT = `# Contract DoD

## ARTIFACT 条目

- [ ] [ARTIFACT] \`harness.js\` 包含 /healthz 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('/healthz'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] 测试文件存在
  Test: node -e "require('fs').accessSync('packages/brain/src/routes/__tests__/harness.healthz.test.js')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] GET /healthz 返回 200
  Test: manual:bash -c 'curl -sf http://localhost:5221/api/brain/harness/healthz'
`;

  it('只提取 [ARTIFACT] 的 Test 命令，排除 [BEHAVIOR]', () => {
    const cmds = mod.extractArtifactTests(CONTRACT);
    expect(cmds.length).toBe(2);
    expect(cmds[0]).toContain("includes('/healthz')");
    expect(cmds[1]).toContain('accessSync');
    // 关键：不能混入 BEHAVIOR 的 curl
    expect(cmds.join('\n')).not.toContain('curl');
  });

  it('strip 掉 manual: 前缀', () => {
    const md = `## ARTIFACT 条目\n- [ ] [ARTIFACT] x\n  Test: manual:node -e "process.exit(0)"\n`;
    expect(mod.extractArtifactTests(md)).toEqual(['node -e "process.exit(0)"']);
  });

  it('无 ARTIFACT 条目 → 空数组', () => {
    expect(mod.extractArtifactTests('## BEHAVIOR\n- [ ] [BEHAVIOR] x\n  Test: curl x\n')).toEqual([]);
    expect(mod.extractArtifactTests('')).toEqual([]);
  });
});

describe('runArtifactGate', () => {
  it('任一命令非零退出 → ok=false + 记 failures（fail-loud）', async () => {
    const execShell = vi.fn(async (cmd) => {
      if (cmd.includes('healthz')) { const e = new Error('exit 1'); e.stderr = 'route missing'; throw e; }
      return { stdout: 'OK' };
    });
    const r = await mod.runArtifactGate({ commands: ['ok-cmd', 'check-healthz'], execShell, cwd: '/tmp/x' });
    expect(r.ok).toBe(false);
    expect(r.failures.length).toBe(1);
    expect(r.failures[0].cmd).toBe('check-healthz');
  });

  it('全部命令退出 0 → ok=true', async () => {
    const execShell = vi.fn(async () => ({ stdout: 'OK' }));
    const r = await mod.runArtifactGate({ commands: ['a', 'b'], execShell, cwd: '/tmp/x' });
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
  });
});

describe('verifyContractArtifactsForPr — 编排（注入 git/gate 依赖）', () => {
  const baseDeps = (overrides = {}) => ({
    execFile: vi.fn(async () => ({ stdout: '' })),
    readContract: vi.fn(async () => '## ARTIFACT 条目\n- [ ] [ARTIFACT] x\n  Test: node -e "process.exit(1)"\n'),
    mkWorktree: vi.fn(async () => '/tmp/wt-abc'),
    rmWorktree: vi.fn(async () => {}),
    runGate: vi.fn(async () => ({ ok: false, failures: [{ cmd: 'node -e ...', error: 'exit 1' }] })),
    ...overrides,
  });

  it('缺 prBranch 或 worktreePath → ran=false（不能 gate，放过给 LLM）', async () => {
    const r = await mod.verifyContractArtifactsForPr({ prBranch: '', sprintDir: 's', worktreePath: '' }, baseDeps());
    expect(r.ran).toBe(false);
  });

  it('合同读不到 → ran=false（fail-open，不误杀）', async () => {
    const deps = baseDeps({ readContract: vi.fn(async () => { throw new Error('no contract'); }) });
    const r = await mod.verifyContractArtifactsForPr({ prBranch: 'cp-x', sprintDir: 's', worktreePath: '/wt' }, deps);
    expect(r.ran).toBe(false);
  });

  it('ARTIFACT 命令失败 → ran=true, ok=false（强制挡 merge），并清理 worktree', async () => {
    const deps = baseDeps();
    const r = await mod.verifyContractArtifactsForPr({ prBranch: 'cp-x', sprintDir: 's', worktreePath: '/wt' }, deps);
    expect(r.ran).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.failures.length).toBe(1);
    expect(deps.rmWorktree).toHaveBeenCalled(); // 必清理临时 worktree
  });

  it('ARTIFACT 全过 → ran=true, ok=true', async () => {
    const deps = baseDeps({ runGate: vi.fn(async () => ({ ok: true, failures: [] })) });
    const r = await mod.verifyContractArtifactsForPr({ prBranch: 'cp-x', sprintDir: 's', worktreePath: '/wt' }, deps);
    expect(r.ran).toBe(true);
    expect(r.ok).toBe(true);
  });
});

describe('evaluateContractNode — ARTIFACT 门强制 FAIL（核心修复）', () => {
  it('ARTIFACT 门 ran && !ok → 返回 verdict=FAIL，且不 spawn LLM evaluator', async () => {
    const spawnSpy = vi.fn(async () => {});
    const verifyArtifacts = vi.fn(async () => ({ ran: true, ok: false, failures: [{ cmd: 'check /healthz', error: 'route missing' }] }));
    const state = {
      evaluate_verdict: null,
      pr_branch: 'cp-06031610-ws-926779b5-ws1',
      pr_url: 'https://github.com/perfectuser21/cecelia/pull/3276',
      githubToken: 'tok',
      initiativeId: 'init-1',
      prdContent: '## target_environment: local_api',
      task: { id: 'task-1', payload: { sprint_dir: 'sprints/open2-verify', journey_type: 'autonomous' } },
    };
    const res = await mod.evaluateContractNode(state, {
      verifyArtifacts,
      spawnDetached: spawnSpy,
      resolveToken: async () => 'tok',
      poolOverride: { query: mockPoolQuery },
    });
    expect(res.evaluate_verdict).toBe('FAIL');
    expect(res.evaluate_error).toMatch(/ARTIFACT/i);
    expect(res.evaluate_error).toMatch(/healthz|route missing/i);
    // 关键：实现没建时直接挡，不浪费 LLM evaluator spawn
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it('ARTIFACT 门 ran=false（无法 gate）→ 不强制 FAIL，继续走 LLM evaluator（spawn 被调）', async () => {
    const spawnSpy = vi.fn(async () => {});
    const verifyArtifacts = vi.fn(async () => ({ ran: false }));
    const state = {
      evaluate_verdict: null,
      pr_branch: 'cp-x',
      githubToken: 'tok',
      initiativeId: 'init-1',
      prdContent: '## target_environment: local_api',
      worktreePath: '/tmp/wt',
      task: { id: 'task-2', payload: { sprint_dir: 'sprints/x', journey_type: 'autonomous' } },
    };
    // interrupt() 会抛（无 checkpointer 上下文），但只要 spawn 被调用即证明走到了 LLM 路径
    await mod.evaluateContractNode(state, {
      verifyArtifacts,
      spawnDetached: spawnSpy,
      resolveToken: async () => 'tok',
      poolOverride: { query: mockPoolQuery },
    }).catch(() => {});
    expect(spawnSpy).toHaveBeenCalled();
  });
});
