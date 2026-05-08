/**
 * W8 Acceptance — Workstream 3: 验收脚本 + 报告 generator
 *
 * 验证：
 *   - run-acceptance.sh 包含必要的反作弊约束（set -euo pipefail / 时间窗口 / docker restart）
 *   - run-acceptance.sh 末尾以 DRY_RUN=0 调 generate-report 产 acceptance-report.md（实跑非 DRY_RUN）
 *   - run-acceptance.sh 含 WS2_FAILED 早退分支（cascade 噪声 mitigation）
 *   - generate-report.mjs 在 DRY_RUN=1 模式下产出 14 行 node 轨迹的 markdown
 *   - 接 --task-id 参数后产出含该 UUID 的报告
 *   - 报告内不留 placeholder
 *   - WS2_FAILED=1 时本测试文件自动 skip（避免 cascade FAIL 噪声）
 *
 * Generator 阶段会创建脚本和模板。Round 2 Red：脚本不存在 → 全 fail。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SCRIPT_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'scripts',
  'run-acceptance.sh'
);
const GENERATOR_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'scripts',
  'generate-report.mjs'
);
const TEMPLATE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'acceptance-report.template.md'
);

const WS2_FAILED = process.env.WS2_FAILED === '1';

describe.skipIf(WS2_FAILED)('Workstream 3 — run-acceptance.sh shape [BEHAVIOR]', () => {
  it("run-acceptance.sh 含 'set -euo pipefail'（任何一步失败立即退出）", () => {
    const c = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(c).toMatch(/^set -euo pipefail/m);
  });

  it("run-acceptance.sh 至少 5 处 psql 查询带 'interval ' 时间窗口（防造假）", () => {
    const c = fs.readFileSync(SCRIPT_PATH, 'utf8');
    const matches = c.match(/interval '/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(5);
  });

  it("run-acceptance.sh 含 'docker restart brain'（kill/resume 实证）", () => {
    const c = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(c).toMatch(/docker restart brain/);
  });

  it("run-acceptance.sh 末尾以 DRY_RUN=0 调 generate-report.mjs 产 acceptance-report.md（实跑非 DRY_RUN）", () => {
    const c = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(c).toMatch(/DRY_RUN=0\s+node\s+[^\n]*generate-report\.mjs/);
  });

  it("run-acceptance.sh 含 WS2_FAILED 早退分支（cascade 噪声 mitigation）", () => {
    const c = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(c).toMatch(/WS2_FAILED/);
  });
});

describe.skipIf(WS2_FAILED)('Workstream 3 — generate-report.mjs DRY_RUN [BEHAVIOR]', () => {
  it('generate-report.mjs 文件存在', () => {
    expect(fs.existsSync(GENERATOR_PATH)).toBe(true);
  });

  it('DRY_RUN=1 下产出含 14 行 node 轨迹的 markdown（不连 PG）', () => {
    const out = execFileSync('node', [GENERATOR_PATH, '--task-id', '11111111-2222-3333-4444-555555555555'], {
      env: { ...process.env, DRY_RUN: '1' },
      encoding: 'utf8',
    });
    const nodeRows = (out.match(
      /^\| (prep|planner|parsePrd|ganLoop|inferTaskPlan|dbUpsert|pick_sub_task|run_sub_task|evaluate|advance|retry|terminal_fail|final_evaluate|report|spawn|await_callback|parse_callback|poll_ci|merge_pr|fix_dispatch) \|/gm
    ) || []).length;
    expect(nodeRows).toBeGreaterThanOrEqual(14);
  });

  it('--task-id 参数后产出报告中含该 UUID 字面量', () => {
    const uuid = '11111111-2222-3333-4444-555555555555';
    const out = execFileSync('node', [GENERATOR_PATH, '--task-id', uuid], {
      env: { ...process.env, DRY_RUN: '1' },
      encoding: 'utf8',
    });
    expect(out).toContain(uuid);
  });

  it('DRY_RUN 输出不含 TODO/<placeholder>/待填/tbd 字面量', () => {
    const out = execFileSync('node', [GENERATOR_PATH, '--task-id', '11111111-2222-3333-4444-555555555555'], {
      env: { ...process.env, DRY_RUN: '1' },
      encoding: 'utf8',
    });
    expect(out).not.toMatch(/\bTODO\b/);
    expect(out).not.toMatch(/<placeholder>/);
    expect(out).not.toMatch(/待填/);
    expect(out).not.toMatch(/\btbd\b/i);
  });

  it('generate-report.mjs 输出报告头部含 DRY_RUN 元数据（区分实跑/DRY_RUN）', () => {
    const out = execFileSync('node', [GENERATOR_PATH, '--task-id', '11111111-2222-3333-4444-555555555555'], {
      env: { ...process.env, DRY_RUN: '1' },
      encoding: 'utf8',
    });
    expect(out).toMatch(/DRY_RUN[:=]\s*1/);
  });
});

describe.skipIf(WS2_FAILED)('Workstream 3 — acceptance-report.template.md [BEHAVIOR]', () => {
  it('模板文件存在并含 14 节点轨迹表的表头骨架', () => {
    expect(fs.existsSync(TEMPLATE_PATH)).toBe(true);
    const c = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    expect(c).toContain('| 节点 | 进入时间 | 出口状态 |');
  });
});
