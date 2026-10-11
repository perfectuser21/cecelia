// lib/qa-smoke.mjs：真人 QA 通过后把 T-n 的 API 命令固化成回归 smoke（审计 #9，决策 c8621227）。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildQaSmoke, registerSmoke, targetsPreviewApi, QA_SMOKE_DIR } from '../lib/qa-smoke.mjs';
import { PRODUCTION_TARGET_RE, PRODUCTION_ASSIGN_RE } from '../lib/qa-report.mjs';

const F = '```';
const PREVIEW = 'http://localhost:5302';
const t = (id, command, verdict = 'PASS') => `### ${id}\n对应: Q-1\nverdict: ${verdict}\n${F}command\n${command}\n${F}\n${F}output\nok\n${F}\n`;
const report = (...items) => `---\ntask_id: x\nstep: evaluate\nupstream: ["02-spec.md#Q-1"]\n---\n# QA 报告\n\n${items.join('\n')}`;
const TASK = 'c954ebfd-469f-4006-a95f-b277fa6564f6';

describe('buildQaSmoke', () => {
  it('只收 PASS 且请求预览环境 API 的 T-n；预览地址换成 $BRAIN_URL；有写请求时第二条命令就是生产保护', () => {
    const s = buildQaSmoke({
      taskId: TASK, previewUrl: PREVIEW, reportText: report(
        t('T-1', `curl -s -X POST ${PREVIEW}/api/brain/tasks -d '{"title":"x"}' | jq -e '.id'`),
        t('T-2', `curl -s ${PREVIEW}/api/brain/tasks?limit=1 | jq -e 'length >= 1'`),
        t('T-3', `curl -s ${PREVIEW}/api/brain/broken`, 'FAIL'),
        t('T-4', `node qa-page.mjs ${PREVIEW}/ # playwright`),
        t('T-5', 'cat packages/brain/src/x.js'),
      ),
    });
    expect(s.name).toBe('cw-c954ebfd-qa-smoke.sh');
    expect(s.writes).toBe(true);
    expect(s.items).toEqual(['T-1', 'T-2']);
    expect(s.content).toContain('BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"');
    expect(s.content).toContain(`curl -q -s -X POST "$BRAIN_URL"/api/brain/tasks -d '{"title":"x"}' | jq -e '.id'`);
    expect(s.content).not.toContain(PREVIEW);
    // 仓库守卫（smoke-production-guard.node-test）：受保护脚本里的 curl 第一个参数必须是 -q（不读外部默认配置）
    expect(s.content).not.toMatch(/\bcurl[ \t]+(?!-q(?:[ \t]|$))/);
    expect(s.content).not.toContain('broken');
    expect(s.content).not.toContain('qa-page');
    const commands = s.content.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    expect(commands[0]).toBe('set -euo pipefail');
    expect(commands[1]).toMatch(/^if ! node .*smoke-production-guard\.mjs/);
  });

  it('只读命令 → 不加生产保护；没有可固化的条目 → null', () => {
    const s = buildQaSmoke({ taskId: TASK, previewUrl: PREVIEW, reportText: report(t('T-1', `curl -s ${PREVIEW}/api/brain/health | jq -e '.status'`)) });
    expect(s.writes).toBe(false);
    expect(s.content).not.toContain('smoke-production-guard');
    expect(buildQaSmoke({ taskId: TASK, previewUrl: PREVIEW, reportText: report(t('T-1', 'echo hi')) })).toBeNull();
  });
});

// 金丝雀 4 第 3 轮独立裁判 J-4：固化脚本可能假通过——单引号里的预览地址换成的 $BRAIN_URL 不展开；
// T-n 是 && 断言链，set -e 不因链中途失败退出，最后照样打印 PASS
describe('生成的 smoke 真跑', () => {
  const runSmoke = (content) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-smoke-run-'));
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    // 假 curl：把收到的 http 地址回显成 URL=<地址>
    fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\nfor a in "$@"; do case "$a" in http*) echo "URL=$a";; esac; done\n', { mode: 0o755 });
    const file = path.join(dir, 'smoke.sh');
    fs.writeFileSync(file, content);
    return spawnSync('bash', [file], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, BRAIN_URL: 'http://brain.test:9' } });
  };

  it('单引号、双引号、不带引号里的预览地址都换成会展开的 $BRAIN_URL', () => {
    const s = buildQaSmoke({
      taskId: TASK, previewUrl: PREVIEW, reportText: report(
        t('T-1', `curl -s '${PREVIEW}/api/brain/x?a=1&b=2' | grep -qF 'URL=http://brain.test:9/api/brain/x?a=1&b=2' && echo Q1_OK`),
        t('T-2', `curl -s "${PREVIEW}/api/brain/y" | grep -qF URL=http://brain.test:9/api/brain/y && echo Q2_OK`),
        t('T-3', `curl -s ${PREVIEW}/api/brain/z | grep -qF URL=http://brain.test:9/api/brain/z && echo Q3_OK`),
      ),
    });
    const r = runSmoke(s.content);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    for (const ok of ['Q1_OK', 'Q2_OK', 'Q3_OK', 'PASS: cw-c954ebfd-qa-smoke.sh']) expect(r.stdout).toContain(ok);
  });

  it('T-n 的 && 断言链中途失败 → 脚本非 0 退出、报出哪条失败、不打印 PASS', () => {
    const s = buildQaSmoke({
      taskId: TASK, previewUrl: PREVIEW, reportText: report(
        t('T-1', `curl -s ${PREVIEW}/api/brain/x | grep -q nope && echo Q1_OK`),
        t('T-2', `curl -s ${PREVIEW}/api/brain/y`),
      ),
    });
    const r = runSmoke(s.content);
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('FAIL: T-1');
    expect(r.stdout).not.toContain('Q1_OK');
    expect(r.stdout).not.toContain('PASS:');
  });
});

describe('prompt（决策 c8621227）', () => {
  it('spec：Q-n 的前提由操作自己造、空库可复现；evaluate：API 命令会固化成回归、必须带断言', () => {
    const spec = fs.readFileSync(new URL('../prompts/spec.md', import.meta.url), 'utf8');
    for (const s of ['自己造', '空库']) expect(spec).toContain(s);
    const evaluate = fs.readFileSync(new URL('../prompts/evaluate.md', import.meta.url), 'utf8');
    for (const s of ['固化成回归', 'smoke', '断言']) expect(evaluate).toContain(s);
  });
});

describe('registerSmoke', () => {
  it('写脚本、登记 allowlist（写请求同时登记 write-targets）；重复登记不重复写行；返回改动的路径', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-smoke-'));
    fs.mkdirSync(path.join(root, 'packages/quality'), { recursive: true });
    fs.writeFileSync(path.join(root, 'packages/quality/smoke-allowlist.txt'), '# allowlist\na-smoke.sh\n');
    fs.writeFileSync(path.join(root, 'packages/quality/smoke-write-targets.txt'), '# targets\n');
    const smoke = { name: 'cw-c954ebfd-qa-smoke.sh', content: '#!/usr/bin/env bash\nset -euo pipefail\n', writes: true };
    const changed = registerSmoke(root, smoke);
    expect(changed).toEqual([`${QA_SMOKE_DIR}/cw-c954ebfd-qa-smoke.sh`, 'packages/quality/smoke-allowlist.txt', 'packages/quality/smoke-write-targets.txt']);
    registerSmoke(root, smoke);
    const allow = fs.readFileSync(path.join(root, 'packages/quality/smoke-allowlist.txt'), 'utf8');
    expect(allow.split('\n').filter((l) => l === 'cw-c954ebfd-qa-smoke.sh')).toHaveLength(1);
    expect(fs.readFileSync(path.join(root, 'packages/quality/smoke-write-targets.txt'), 'utf8')).toContain('cw-c954ebfd-qa-smoke.sh\n');
    expect(fs.statSync(path.join(root, QA_SMOKE_DIR, 'cw-c954ebfd-qa-smoke.sh')).mode & 0o111).toBeTruthy();
  });
});

// 金丝雀 4 r10 / 5 r3 / 6 r3：QA 把预览地址先赋给变量再拼 /api（B=http://localhost:530x; curl "$B/api/..."），
// 旧筛选只认字面量「<预览地址>/api/」，三只金丝雀一条都没固化（smoke=null、只记 smoke_note）
describe('预览地址赋给变量（金丝雀 4 r10/5/6）', () => {
  const P = 'http://localhost:5305';
  const VAR_CMD = `B=${P}; R=$(curl -s -X POST "$B/api/brain/strategic-decisions" -H 'Content-Type: application/json' -d '{"category":"decision"}'); echo "$R" | jq -e '.success'`;

  it('B=<预览地址>; curl "$B/api/…" → 收；预览地址换成 $BRAIN_URL、无端口残留', () => {
    const s = buildQaSmoke({ taskId: TASK, previewUrl: P, reportText: report(t('T-1', VAR_CMD)) });
    expect(s).not.toBeNull();
    expect(s.items).toEqual(['T-1']);
    expect(s.content).toContain('B="$BRAIN_URL";');
    expect(s.content).not.toContain('5305');
    expect(s.skipped).toEqual([]);
  });

  it('打其他本机端口 / 依赖本机路径 / 打生产 / 开浏览器 / 不打预览 → 剔除并写明原因', () => {
    const s = buildQaSmoke({
      taskId: TASK, previewUrl: P, reportText: report(
        t('T-1', VAR_CMD),
        t('T-2', `B=${P}; curl -s "http://127.0.0.1:5299/api/brain/runs/x" | jq -e .`),
        t('T-3', `B=${P}; cd /Users/x/worktree && node /tmp/a.mjs "$B/api/brain/x"`),
        t('T-4', `B=http://localhost:5221; curl -s "$B/api/brain/tasks" | jq -e .`),
        t('T-5', `B=${P}; node qa-page.mjs "$B/api/x" # playwright`),
        t('T-6', 'cat packages/brain/src/x.js'),
        t('T-7', `B=${P}; curl -s "$B/api/brain/broken"`, 'FAIL'),
      ),
    });
    expect(s.items).toEqual(['T-1']);
    expect(s.skipped).toEqual([
      { id: 'T-2', reason: 'other_port' },
      { id: 'T-3', reason: 'local_path' },
      { id: 'T-4', reason: 'production' },
      { id: 'T-5', reason: 'browser' },
      { id: 'T-6', reason: 'not_preview' },
    ]);
  });

  it('targetsPreviewApi：变量赋值或字面量才算；端口前缀相同的别的端口不算', () => {
    expect(targetsPreviewApi(VAR_CMD, P)).toBe(true);
    expect(targetsPreviewApi(`curl -s ${P}/api/brain/x`, P)).toBe(true);
    expect(targetsPreviewApi(`export B='${P}'; curl -s "\${B}/api/brain/x"`, P)).toBe(true);
    expect(targetsPreviewApi(`B=${P}0; curl -s "$B/api/brain/x"`, P)).toBe(false);
    expect(targetsPreviewApi(`B=${P}; curl -s "$C/api/brain/x"`, P)).toBe(false);
    expect(targetsPreviewApi(`B=${P}; curl -s "$B/health"`, P)).toBe(false);
  });

  it('生产判定正则从 qa-report 导出，供固化筛选复用', () => {
    expect(PRODUCTION_TARGET_RE.test('curl localhost:5221/api')).toBe(true);
    expect(PRODUCTION_ASSIGN_RE.test('B=http://localhost:5221; curl $B')).toBe(true);
  });

  it('真实样本回放：金丝雀 6 r3 T-1 原文被收，生成的 smoke 在假 Brain 下跑到 PASS', () => {
    const reportText = fs.readFileSync(new URL('./fixtures/canary6-r3-qa-report-t1.md', import.meta.url), 'utf8');
    const s = buildQaSmoke({ taskId: '142c9ad0-2150-4f03-978c-3dd30ab32ed1', previewUrl: 'http://localhost:5301', reportText });
    expect(s).not.toBeNull();
    expect(s.items).toEqual(['T-1']);
    expect(s.content).not.toContain('5301');
    expect(s.content).not.toContain('playwright');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-smoke-c6-'));
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    // 假 Brain：只认 $BRAIN_URL/api/brain/runs/<s>，回 404 + run not found；地址没展开就回 500
    fs.writeFileSync(path.join(bin, 'curl'), [
      '#!/bin/sh',
      'for a in "$@"; do case "$a" in http*) u="$a";; esac; done',
      'case "$u" in "$BRAIN_URL"/api/brain/runs/*) printf \'{"error":"run not found: %s"}\\n404\' "${u##*/}";; *) printf \'{}\\n500\';; esac',
      '',
    ].join('\n'), { mode: 0o755 });
    const file = path.join(dir, 'smoke.sh');
    fs.writeFileSync(file, s.content);
    const r = spawnSync('bash', [file], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, BRAIN_URL: 'http://brain.test:9' } });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('ALL_OK');
    expect(r.stdout).toContain('PASS: cw-142c9ad0-qa-smoke.sh');
  });
});
