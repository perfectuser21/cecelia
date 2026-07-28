/**
 * harness-promote-regression.test.js — A3 冻结登记单测。
 * 纯函数：parseBehaviorEntries / parseGoldenPathSteps / buildGoldenPathEntries / mergeGoldenPaths
 * 主函数：promoteToRegression（mock pool + execFile + fs 注入，见 Task 2 追加的 describe）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  parseBehaviorEntries,
  parseGoldenPathSteps,
  buildGoldenPathEntries,
  mergeGoldenPaths,
} from '../harness-promote-regression.js';

describe('parseBehaviorEntries', () => {
  it('标准格式：desc + manual: 命令成对提取', () => {
    const md = [
      '## BEHAVIOR 条目',
      '',
      '- [ ] [BEHAVIOR] 发布成功且 DB 有新记录',
      "  Test: manual:bash -c 'curl -s $API | jq -e \".ok\"'",
      '- [x] [BEHAVIOR] 页面显示文字',
      '  Test: manual:node -e "process.exit(0)"',
    ].join('\n');
    const out = parseBehaviorEntries(md);
    expect(out).toHaveLength(2);
    expect(out[0].desc).toBe('发布成功且 DB 有新记录');
    expect(out[0].cmd).toBe("bash -c 'curl -s $API | jq -e \".ok\"'");
    expect(out[1].desc).toBe('页面显示文字');
    expect(out[1].cmd).toBe('node -e "process.exit(0)"');
  });

  it('无 Test: manual: 行的 BEHAVIOR 条目被跳过（不产半卡）', () => {
    const md = '- [ ] [BEHAVIOR] 只有描述没有命令\n\n- [ ] [BEHAVIOR] 有命令\n  Test: manual:true';
    const out = parseBehaviorEntries(md);
    expect(out).toHaveLength(1);
    expect(out[0].cmd).toBe('true');
  });

  it('无匹配 → 空数组', () => {
    expect(parseBehaviorEntries('# 空文档')).toEqual([]);
  });
});

describe('parseGoldenPathSteps', () => {
  it('标准 ## Golden Path 段编号列表', () => {
    const md = [
      '# sprint-prd',
      '## Golden Path（核心场景）',
      '用户从 [入口] → 到达 [出口]',
      '具体：',
      '1. 用户点击发布',
      '2. 系统调用 API',
      '3. 页面出现成功提示',
      '',
      '## 下一段',
    ].join('\n');
    const out = parseGoldenPathSteps(md);
    expect(out).toEqual([
      { order_no: 1, note: '用户点击发布' },
      { order_no: 2, note: '系统调用 API' },
      { order_no: 3, note: '页面出现成功提示' },
    ]);
  });

  it('段缺失 → 空数组（调用方降级到 BEHAVIOR 序号）', () => {
    expect(parseGoldenPathSteps('# 无 golden path 段')).toEqual([]);
  });
});

describe('buildGoldenPathEntries', () => {
  const base = {
    taskId: 'bd7e251c-0000-0000-0000-000000000001',
    journeyId: 'bb8cc561-b3ee-4fec-b74d-2255694bd963',
    behaviors: [
      { desc: '发布成功', cmd: 'bash -c true' },
      { desc: '记录落库', cmd: 'psql "$DB" -c "SELECT 1" | grep -q 1' },
    ],
    prUrl: 'https://github.com/x/y/pull/1',
    sprintDir: 'sprints/0702-demo',
    now: '2026-07-02T03:00:00.000Z',
  };

  it('每个 BEHAVIOR 一条，schema 对齐 run-core-regression.sh 消费字段', () => {
    const out = buildGoldenPathEntries(base);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      id: 'GP-bd7e251c-001',
      name: '发布成功',
      priority: 'P0',
      trigger: ['PR', 'Release'],
      method: 'auto',
      test_command: 'bash -c true',
      owner_task_id: base.taskId,
      journey_id: base.journeyId,
    });
    expect(out[1].id).toBe('GP-bd7e251c-002');
    expect(out[0].source).toMatchObject({
      pr_url: base.prUrl,
      sprint_dir: base.sprintDir,
      frozen_at: base.now,
    });
  });
});

describe('mergeGoldenPaths', () => {
  it('幂等：同 task 前缀旧条目被覆盖，跑两次条目数不翻倍', () => {
    const fresh = [
      { id: 'GP-bd7e251c-001', name: 'v2 卡片', test_command: 'true' },
    ];
    const existing = [
      { id: 'CORE-001', name: '别人的卡', test_command: 'node --check x.js' },
      { id: 'GP-bd7e251c-001', name: 'v1 旧卡', test_command: 'false' },
      { id: 'GP-bd7e251c-002', name: 'v1 已删步骤的旧卡', test_command: 'false' },
    ];
    const merged = mergeGoldenPaths(existing, fresh, 'GP-bd7e251c-');
    expect(merged).toHaveLength(2);
    expect(merged.find((g) => g.id === 'CORE-001')).toBeTruthy();
    expect(merged.find((g) => g.id === 'GP-bd7e251c-001').name).toBe('v2 卡片');
    expect(merged.find((g) => g.id === 'GP-bd7e251c-002')).toBeUndefined();
    // 再跑一次不翻倍
    const twice = mergeGoldenPaths(merged, fresh, 'GP-bd7e251c-');
    expect(twice).toHaveLength(2);
  });

  it('existing 为空/undefined 容忍', () => {
    expect(mergeGoldenPaths(undefined, [{ id: 'GP-a-001' }], 'GP-a-')).toHaveLength(1);
  });
});

describe('promoteToRegression', () => {
  const TASK = {
    id: 'bd7e251c-0000-0000-0000-000000000001',
    payload: {
      journey_id: 'bb8cc561-b3ee-4fec-b74d-2255694bd963',
      feature_id: 'fe000000-0000-0000-0000-000000000001',
    },
  };
  const SPRINT_DIR = 'sprints/0702-demo';
  const WT = '/tmp/fake-worktree';

  function makeDeps({ lsFilesFails = false, files = {} } = {}) {
    const queries = [];
    const client = {
      query: vi.fn(async (sql, params) => {
        queries.push({ sql, params });
        if (/SELECT id FROM journey_features/i.test(sql)) return { rows: [{ id: params[0] }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const poolMock = { connect: vi.fn(async () => client) };
    const execFileCalls = [];
    const execFileMock = vi.fn(async (cmd, args, opts2) => {
      execFileCalls.push({ cmd, args });
      if (cmd === 'git' && args[0] === 'ls-files' && lsFilesFails) {
        const e = new Error('not tracked'); e.code = 1; throw e;
      }
      return { stdout: '', stderr: '' };
    });
    const fsMock = {
      readFileSync: vi.fn((p) => {
        const key = Object.keys(files).find((k) => String(p).endsWith(k));
        if (key) return files[key];
        const e = new Error(`ENOENT ${p}`); e.code = 'ENOENT'; throw e;
      }),
      writeFileSync: vi.fn(),
      existsSync: vi.fn((p) => Object.keys(files).some((k) => String(p).endsWith(k))),
    };
    return { poolMock, client, queries, execFileMock, execFileCalls, fsMock };
  }

  const GOOD_FILES = {
    'sprint-prd.md': '## Golden Path\n1. 步骤一\n2. 步骤二\n',
    'contract-dod.md': '- [ ] [BEHAVIOR] 行为一\n  Test: manual:true\n',
    'regression-contract.yaml': 'version: "1.0.0"\nupdated: "2026-02-04"\ncore: []\ngolden_paths: []\n',
  };

  let promoteToRegression;
  beforeEach(async () => {
    ({ promoteToRegression } = await import('../harness-promote-regression.js'));
  });

  it('happy path：DB 覆盖写 + yaml draft PR，绝不自授 merge', async () => {
    const d = makeDeps({ files: GOOD_FILES });
    const r = await promoteToRegression(
      { pool: d.poolMock, execFile: d.execFileMock, fsImpl: d.fsMock },
      { task: TASK, sprintDir: SPRINT_DIR, subTasks: [{ pr_url: 'https://github.com/x/y/pull/9' }], worktreePath: WT },
    );
    expect(r.ok).toBe(true);
    expect(r.dbWritten).toBe(true);
    const sqls = d.queries.map((q) => q.sql);
    expect(sqls.some((s) => /BEGIN/i.test(s))).toBe(true);
    expect(sqls.some((s) => /DELETE FROM golden_path WHERE owner_task_id/i.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT INTO golden_path/i.test(s))).toBe(true);
    expect(sqls.some((s) => /COMMIT/i.test(s))).toBe(true);
    // yaml 写入 + git 流程被调用（fetch origin main / checkout -b <branch> origin/main / commit pathspec / push / gh pr create）
    expect(d.fsMock.writeFileSync).toHaveBeenCalled();
    const gitArgs = d.execFileCalls.map((c) => `${c.cmd} ${c.args.join(' ')}`);
    expect(gitArgs.some((s) => s === 'git fetch origin main')).toBe(true);
    expect(gitArgs.some((s) => s.includes('checkout -b') && s.endsWith('origin/main'))).toBe(true);
    const commitCall = d.execFileCalls.find((c) => c.cmd === 'git' && c.args[0] === 'commit');
    expect(commitCall.args.slice(-2)).toEqual(['--', 'regression-contract.yaml']);
    expect(gitArgs.some((s) => s.startsWith('gh pr create') && s.includes('--draft'))).toBe(true);
    expect(gitArgs.some((s) => s.startsWith('gh pr merge'))).toBe(false);
  });

  it('commit 校验失败（contract-dod.md 未被 git 跟踪）→ yaml 跳过但 DB 保留', async () => {
    const d = makeDeps({ files: GOOD_FILES, lsFilesFails: true });
    const r = await promoteToRegression(
      { pool: d.poolMock, execFile: d.execFileMock, fsImpl: d.fsMock },
      { task: TASK, sprintDir: SPRINT_DIR, subTasks: [], worktreePath: WT },
    );
    expect(r.dbWritten).toBe(true);
    expect(r.yamlPrUrl == null).toBe(true);
    expect(d.fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it('worktreePath/sprintDir 为空 → 整体 skipped，不碰 DB', async () => {
    const d = makeDeps({ files: GOOD_FILES });
    const r = await promoteToRegression(
      { pool: d.poolMock, execFile: d.execFileMock, fsImpl: d.fsMock },
      { task: TASK, sprintDir: null, subTasks: [], worktreePath: WT },
    );
    expect(r.skipped).toBe(true);
    expect(d.poolMock.connect).not.toHaveBeenCalled();
  });

  it('sprint-prd 无 Golden Path 段 → 降级用 BEHAVIOR 序号写 golden_path 表', async () => {
    const files = { ...GOOD_FILES, 'sprint-prd.md': '# 没有 golden path 段' };
    const d = makeDeps({ files });
    const r = await promoteToRegression(
      { pool: d.poolMock, execFile: d.execFileMock, fsImpl: d.fsMock },
      { task: TASK, sprintDir: SPRINT_DIR, subTasks: [], worktreePath: WT },
    );
    expect(r.dbWritten).toBe(true);
    const ins = d.queries.find((q) => /INSERT INTO golden_path/i.test(q.sql));
    expect(ins.params.join(' ')).toContain('行为一'); // 降级 note = BEHAVIOR 描述
  });

  it('dbOnly=true 时写完 DB 直接返回，不跑 git/yaml', async () => {
    const d = makeDeps({ files: GOOD_FILES });
    const r = await promoteToRegression(
      { pool: d.poolMock, execFile: d.execFileMock, fsImpl: d.fsMock },
      { task: TASK, sprintDir: SPRINT_DIR, subTasks: [], worktreePath: WT, dbOnly: true },
    );
    expect(r).toEqual({ ok: true, dbWritten: true, yamlPrUrl: null, reason: 'db_only' });
    // 没碰 git/gh
    expect(d.execFileMock).not.toHaveBeenCalled();
    expect(d.fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it('payload.feature_id 缺失时回退 task.ability_id 写入 feature_id', async () => {
    const abilityId = 'ab000000-0000-0000-0000-000000000009';
    const task = {
      id: TASK.id,
      ability_id: abilityId,
      payload: { journey_id: TASK.payload.journey_id }, // 无 feature_id
    };
    const d = makeDeps({ files: GOOD_FILES });
    const r = await promoteToRegression(
      { pool: d.poolMock, execFile: d.execFileMock, fsImpl: d.fsMock },
      { task, sprintDir: SPRINT_DIR, subTasks: [], worktreePath: WT },
    );
    expect(r.dbWritten).toBe(true);
    const ins = d.queries.find((q) => /INSERT INTO golden_path/i.test(q.sql));
    expect(ins.params[2]).toBe(abilityId); // 第 3 个参数 = feature_id 回退到 ability_id
  });

  it('payload.feature_id 存在但 journey_features 查不到 → 回退 ability_id', async () => {
    const badFeatureId = 'fe999999-9999-9999-9999-999999999999';
    const abilityId = 'ab000000-0000-0000-0000-000000000009';
    const task = {
      id: TASK.id,
      ability_id: abilityId,
      payload: { journey_id: TASK.payload.journey_id, feature_id: badFeatureId },
    };
    const d = makeDeps({ files: GOOD_FILES });
    // 按入参 id 路由：feature_id 候选查不到（rows 空），ability_id 候选存在
    d.client.query.mockImplementation(async (sql, params) => {
      d.queries.push({ sql, params });
      if (/SELECT id FROM journey_features/i.test(sql)) {
        return params[0] === abilityId ? { rows: [{ id: params[0] }] } : { rows: [] };
      }
      return { rows: [] };
    });
    const r = await promoteToRegression(
      { pool: d.poolMock, execFile: d.execFileMock, fsImpl: d.fsMock },
      { task, sprintDir: SPRINT_DIR, subTasks: [], worktreePath: WT },
    );
    expect(r.dbWritten).toBe(true);
    const ins = d.queries.find((q) => /INSERT INTO golden_path/i.test(q.sql));
    expect(ins.params[2]).toBe(abilityId); // 无效 feature_id 被跳过，回退 ability_id
  });

  it('DB 阶段抛错 → ROLLBACK 且不抛出（best-effort，返回 ok:false）', async () => {
    const d = makeDeps({ files: GOOD_FILES });
    d.client.query.mockImplementation(async (sql) => {
      if (/INSERT INTO golden_path/i.test(sql)) throw new Error('db boom');
      d.queries.push({ sql });
      return { rows: [] };
    });
    const r = await promoteToRegression(
      { pool: d.poolMock, execFile: d.execFileMock, fsImpl: d.fsMock },
      { task: TASK, sprintDir: SPRINT_DIR, subTasks: [], worktreePath: WT },
    );
    expect(r.ok).toBe(false);
  });
});
