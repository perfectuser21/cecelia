// Harness v2 M3 — parseTasks 单元测试 + SKILL.md 格式校验
// 对应 plan: docs/superpowers/plans/2026-04-19-harness-v2-m3-gan-contract.md

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseTasks, parseWorkstreams } from '../harness-graph.js';

const contractV2 = `
# Sprint Contract Draft

## 范围总览

Initiative 总体目标描述

## Tasks

### Task: task-alpha
**title**: 实现 A 功能
**scope**: 只动 moduleA
**depends_on**: []
**files**: [src/a.js, src/a.test.js]

#### DoD
- [ARTIFACT] 文件 src/a.js 存在
- [BEHAVIOR] 调 /api/a 返回 200

#### Unit Test Plan（强制测试金字塔）
- 覆盖点 1: moduleA.funcA 返回值
- 覆盖点 2: 空输入

#### Integration Test Plan（强制）
- 场景 1: moduleA + moduleB 联调

#### 验证命令
- manual:node -e "require('./src/a.js')"

### Task: task-beta
**title**: 实现 B 功能
**scope**: 只动 moduleB
**depends_on**: [task-alpha]
**files**: [src/b.js]

#### DoD
- [BEHAVIOR] 调 /api/b 返回 200

#### Unit Test Plan（强制测试金字塔）
- 覆盖点 1: moduleB.funcB

#### Integration Test Plan（强制）
- 场景 1: moduleB 读 DB

#### 验证命令
- manual:curl localhost:5221/api/b

### Task: task-gamma
**title**: 实现 C 功能
**scope**: 只动 moduleC
**depends_on**: [task-beta]
**files**: [src/c.js]

#### DoD
- [ARTIFACT] 文件 src/c.js 存在

#### Unit Test Plan（强制测试金字塔）
- 覆盖点 1: moduleC.funcC

#### Integration Test Plan（强制）
- 场景 1: moduleC + moduleA 联调

#### 验证命令
- manual:node -e "require('./src/c.js')"

## E2E Acceptance

- Given 用户 X，When 调 /api/a，Then 返回 ...
`;

const contractV1 = `
# Old Contract

## Workstreams

workstream_count: 2

### Workstream 1: ws-alpha
**范围**: 改 A
**DoD**:
- [ ] [BEHAVIOR] 行为 A
  Test: curl localhost:5221/api/a
`;

describe('parseTasks', () => {
  it('V2 合同：parseTasks 返回 3 个 task', () => {
    const tasks = parseTasks(contractV2);
    expect(tasks).toHaveLength(3);
    expect(tasks.map(t => t.task_id)).toEqual(['task-alpha', 'task-beta', 'task-gamma']);
  });

  it('V2 合同：每个 task 含 dod / unit_test_plan / integration_test_plan 字段', () => {
    const tasks = parseTasks(contractV2);
    for (const t of tasks) {
      expect(t.dod).toBeTruthy();
      expect(t.unit_test_plan).toBeTruthy();
      expect(t.integration_test_plan).toBeTruthy();
    }
    expect(tasks[0].dod).toMatch(/ARTIFACT|BEHAVIOR/);
    expect(tasks[0].unit_test_plan).toMatch(/覆盖点/);
    expect(tasks[0].integration_test_plan).toMatch(/场景/);
  });

  it('V2 合同：task 含 title / scope / depends_on / files 字段', () => {
    const tasks = parseTasks(contractV2);
    expect(tasks[0].title).toContain('A 功能');
    expect(tasks[0].scope).toContain('moduleA');
    expect(tasks[0].depends_on).toEqual([]);
    expect(tasks[1].depends_on).toEqual(['task-alpha']);
    expect(tasks[0].files).toContain('src/a.js');
    expect(tasks[0].files).toContain('src/a.test.js');
  });

  it('V1 合同（Workstreams 格式）：parseTasks 返回空数组', () => {
    const tasks = parseTasks(contractV1);
    expect(tasks).toEqual([]);
  });

  it('V1 合同：parseWorkstreams 仍能解析（向后兼容）', () => {
    const ws = parseWorkstreams(contractV1);
    expect(ws.length).toBeGreaterThan(0);
    expect(ws[0].index).toBe(1);
  });

  it('空/非字符串输入：parseTasks 返回空数组', () => {
    expect(parseTasks(null)).toEqual([]);
    expect(parseTasks('')).toEqual([]);
    expect(parseTasks(undefined)).toEqual([]);
  });
});

describe('SKILL.md 格式校验', () => {
  // 对 4 份 SKILL.md 同步位置都做检查
  const skillDirs = [
    join(homedir(), '.claude-account1', 'skills'),
    join(homedir(), '.claude-account2', 'skills'),
    join(homedir(), '.claude-account3', 'skills'),
    join(homedir(), '.claude', 'skills'),
  ];

  for (const base of skillDirs) {
    const proposerPath = join(base, 'harness-contract-proposer', 'SKILL.md');
    const reviewerPath = join(base, 'harness-contract-reviewer', 'SKILL.md');

    // 仅当文件存在时运行该断言（不同机器/账号位置可能不全）
    it.runIf(existsSync(proposerPath))(
      `Proposer SKILL.md 含 "## Tasks" (${base})`,
      () => {
        const content = readFileSync(proposerPath, 'utf8');
        expect(content).toMatch(/##\s+Tasks/);
      }
    );

    it.runIf(existsSync(proposerPath))(
      `Proposer SKILL.md 含 "E2E Acceptance" (${base})`,
      () => {
        const content = readFileSync(proposerPath, 'utf8');
        expect(content).toMatch(/E2E Acceptance/i);
      }
    );

    it.runIf(existsSync(reviewerPath))(
      `Reviewer SKILL.md 含 "找不到 ≥2 个" 或 "at least 2" (${base})`,
      () => {
        const content = readFileSync(reviewerPath, 'utf8');
        expect(/找不到\s*≥\s*2\s*个|at least 2/i.test(content)).toBe(true);
      }
    );

    it.runIf(existsSync(reviewerPath))(
      `Reviewer SKILL.md 不含 "避免无限挑剔" / "避免过度挑剔" (${base})`,
      () => {
        const content = readFileSync(reviewerPath, 'utf8');
        expect(content).not.toMatch(/避免无限挑剔/);
        expect(content).not.toMatch(/避免过度挑剔/);
      }
    );
  }
});
