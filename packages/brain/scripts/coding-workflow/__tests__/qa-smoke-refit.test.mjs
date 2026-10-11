// C2c：固化的 cw-*-qa-smoke.sh 在 PR 的 Smoke Glob Runner 首跑失败 → 从 CI 日志 `FAIL: T-n` 定位失败条目、从脚本里剔除。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildQaSmoke, registerSmoke, smokeCiFailures, dropSmokeBlocks, unregisterSmoke, QA_SMOKE_DIR } from '../lib/qa-smoke.mjs';

const F = '```';
const PREVIEW = 'http://localhost:5301';
const t = (id, command) => `### ${id}\n对应: Q-1\nverdict: PASS\n${F}command\n${command}\n${F}\n${F}output\nok\n${F}\n`;
const report = (ids) => `---\ntask_id: x\nstep: evaluate\nupstream: ["02-spec.md#Q-1"]\n---\n# QA 报告\n\n${
  ids.map((id, i) => t(id, `curl -s ${PREVIEW}/api/brain/x${i} | jq -e '.ok'`)).join('\n')}`;
const smokeOf = (ids) => buildQaSmoke({ taskId: 'abcdef12-0000-4000-8000-000000000000', previewUrl: PREVIEW, reportText: report(ids) });
const NAME = 'cw-abcdef12-qa-smoke.sh';

// Smoke Glob Runner 的输出形态（run-smoke-ratchet.sh；Actions 时间戳由调用方去掉）
const ratchetLog = (name, failId) => [
  '🔬 Smoke Ratchet Gate',
  '── ▶  aaa-smoke.sh',
  'FAIL: T-9',
  '── ✅ PASS: aaa-smoke.sh',
  `── ▶  ${name}`,
  '== T-1（对应 Q-1）',
  '{"ok":true}',
  `== ${failId}（对应 Q-2）`,
  '{"ok":false}',
  `FAIL: ${failId}`,
  `::error::❌ BASELINE FAIL (exit 1): ${name}`,
  '── ▶  zzz-smoke.sh',
  '── ✅ PASS: zzz-smoke.sh',
  '❌ 基线脚本失败（必须修复后才能合并）：',
  `   - ${name}`,
].join('\n');

describe('smokeCiFailures：从 Smoke Glob Runner 日志定位本 PR smoke 的失败条目', () => {
  it('本脚本基线失败 → failed=true，只取本脚本段里的 FAIL: T-n（别的脚本输出的 FAIL 不算）', () => {
    expect(smokeCiFailures(ratchetLog(NAME, 'T-2'), NAME)).toEqual({ failed: true, ids: ['T-2'] });
  });

  it('本脚本通过、失败的是别的脚本 → failed=false', () => {
    const log = [`── ▶  ${NAME}`, `── ✅ PASS: ${NAME}`, '── ▶  other.sh', 'FAIL: T-1', '::error::❌ BASELINE FAIL (exit 1): other.sh'].join('\n');
    expect(smokeCiFailures(log, NAME)).toEqual({ failed: false, ids: [] });
  });

  it('本脚本失败但日志里没有 FAIL: T-n（例如语法错）→ failed=true、ids 为空', () => {
    const log = [`── ▶  ${NAME}`, 'line 3: syntax error', `::error::❌ BASELINE FAIL (exit 2): ${NAME}`].join('\n');
    expect(smokeCiFailures(log, NAME)).toEqual({ failed: true, ids: [] });
  });

  it('日志为空 / 没跑到本脚本 → failed=false', () => {
    expect(smokeCiFailures('', NAME)).toEqual({ failed: false, ids: [] });
  });
});

describe('dropSmokeBlocks：从 runner 生成的 smoke 里剔除条目', () => {
  it('剔除 T-2：剩 T-1、T-3，脚本语法仍正确（bash -n）且 T-2 不留痕', () => {
    const smoke = smokeOf(['T-1', 'T-2', 'T-3']);
    const r = dropSmokeBlocks(smoke.content, ['T-2']);
    expect(r).toMatchObject({ removed: ['T-2'], items: ['T-1', 'T-3'] });
    expect(r.content).not.toContain('T-2');
    expect(r.content).toContain('FAIL: T-1');
    expect(r.content).toContain('FAIL: T-3');
    expect(r.content).toContain(`PASS: ${NAME}`);
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-refit-')), 'x.sh');
    fs.writeFileSync(tmp, r.content);
    expect(spawnSync('bash', ['-n', tmp]).status).toBe(0);
  });

  it('要剔的条目不在脚本里 → removed 为空、内容不变', () => {
    const smoke = smokeOf(['T-1']);
    expect(dropSmokeBlocks(smoke.content, ['T-7'])).toEqual({ content: smoke.content, removed: [], items: ['T-1'] });
  });

  it('剔光 → items 为空', () => {
    expect(dropSmokeBlocks(smokeOf(['T-1']).content, ['T-1'])).toMatchObject({ removed: ['T-1'], items: [] });
  });
});

describe('unregisterSmoke：零固化时删脚本并撤登记', () => {
  it('删脚本、从 allowlist / write-targets 撤掉这一行，别的行不动；返回改动路径', () => {
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-unreg-'));
    fs.mkdirSync(path.join(wt, 'packages/quality'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'packages/quality/smoke-allowlist.txt'), 'a.sh\n');
    fs.writeFileSync(path.join(wt, 'packages/quality/smoke-write-targets.txt'), 'b.sh\n');
    const smoke = { ...smokeOf(['T-1']), writes: true };
    registerSmoke(wt, smoke);
    const changed = unregisterSmoke(wt, smoke.name);
    expect(fs.existsSync(path.join(wt, QA_SMOKE_DIR, smoke.name))).toBe(false);
    expect(fs.readFileSync(path.join(wt, 'packages/quality/smoke-allowlist.txt'), 'utf8')).toBe('a.sh\n');
    expect(fs.readFileSync(path.join(wt, 'packages/quality/smoke-write-targets.txt'), 'utf8')).toBe('b.sh\n');
    expect(changed).toEqual([`${QA_SMOKE_DIR}/${smoke.name}`, 'packages/quality/smoke-allowlist.txt', 'packages/quality/smoke-write-targets.txt']);
  });
});
