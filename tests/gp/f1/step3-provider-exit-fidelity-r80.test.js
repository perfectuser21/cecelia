// F1「工厂·开发闭环」步骤3「造完真验」—— 边：runner/entrypoint 回执 ↔ 结构化终态保真透传（r80）
//
// 病根三实证：结构化终态（success 结果 JSON / 结构化 BLOCKED + CONTRACT_*）在 CLI 退出码非零时被
// entrypoint 一律降级为 failure_code=provider_exit → 真因埋没（r69/r76/r77）。
//
// 本文件是 root 侧断言：真 bash 跑 entrypoint.sh 原文提取的函数（真零件，不 mock 被改的边），
// 断言「有结构化终态 → 保真透传该终态；无结构化产出的真崩溃 → 仍 provider_exit（负向语义不变）」。
// 与 step3-red-purity-import-contract.test.js 的 extractFn/真 bash 手法同源。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTRYPOINT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../docker/cecelia-runner/entrypoint.sh',
);

// 从 entrypoint.sh 原文按顶层函数边界切片（`^name() {` 到下一行 `^}`），比 JS 正则贪婪匹配更稳。
function extractFn(name) {
  const lines = fs.readFileSync(ENTRYPOINT_PATH, 'utf8').split('\n');
  const start = lines.findIndex((l) => l === `${name}() {`);
  expect(start, `entrypoint.sh 必须定义 ${name}()`).toBeGreaterThan(-1);
  let end = -1;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i] === '}') { end = i; break; }
  }
  expect(end, `${name}() 必须以列首 '}' 收尾`).toBeGreaterThan(start);
  return lines.slice(start, end + 1).join('\n');
}

let workdir;
beforeEach(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'r80-entrypoint-'));
});
afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

function tmpJson(name, obj) {
  const p = path.join(workdir, name);
  fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj));
  return p;
}

// 真 bash 跑：source 提取的函数 + 一条命令，回传 stdout。
function runBash(fnNames, cmd) {
  const script = ['set -uo pipefail', ...fnNames.map(extractFn), cmd].join('\n');
  return execFileSync('bash', ['-c', script], { encoding: 'utf8' }).trim();
}

describe('A. detect_structured_terminal —— 结构化终态识别（真 bash 提取函数）', () => {
  it('A1 结构化 BLOCKED + CONTRACT_* → 回传该真因码（r69 场景，不埋没）', () => {
    const f = tmpJson('blocked.json', { status: 'blocked', error: { code: 'CONTRACT_SELF_CONTRADICTION' } });
    expect(runBash(['detect_structured_terminal'], `detect_structured_terminal '${f}'`))
      .toBe('CONTRACT_SELF_CONTRADICTION');
  });

  it('A2 claude 流式外壳 .structured_output 内的结构化 BLOCKED 也被解包识别', () => {
    const f = tmpJson('wrapped.json', {
      type: 'result',
      structured_output: { status: 'blocked', error: { code: 'CONTRACT_TEST_UNSATISFIABLE' } },
    });
    expect(runBash(['detect_structured_terminal'], `detect_structured_terminal '${f}'`))
      .toBe('CONTRACT_TEST_UNSATISFIABLE');
  });

  it('A3 结构化 success 结果 JSON（status=completed）→ 回传 __structured_success__（r77 场景）', () => {
    const f = tmpJson('success.json', { status: 'completed', decision: { outcome: 'APPROVED', reason: 'x' } });
    expect(runBash(['detect_structured_terminal'], `detect_structured_terminal '${f}'`))
      .toBe('__structured_success__');
  });

  it('A4 commander-directive/v1 结构化 success → 回传 __structured_success__（r77 commander 场景）', () => {
    const f = tmpJson('commander.json', { schema: 'commander-directive/v1', directives: [] });
    expect(runBash(['detect_structured_terminal'], `detect_structured_terminal '${f}'`))
      .toBe('__structured_success__');
  });

  it('A5 真 provider 崩溃（无结构化产出）→ 回传空（落回 provider_exit）', () => {
    const f = tmpJson('crash.txt', 'Segmentation fault (core dumped)\n');
    expect(runBash(['detect_structured_terminal'], `detect_structured_terminal '${f}'`)).toBe('');
  });

  it('A6 结构化 status=failed 的普通失败不当作可透传终态 → 回传空（负向语义不变）', () => {
    const f = tmpJson('failed.json', { status: 'failed', error: { code: 'provider_exit' } });
    expect(runBash(['detect_structured_terminal'], `detect_structured_terminal '${f}'`)).toBe('');
  });
});

describe('B. normalize_provider_failure —— 结构化 BLOCKED 保真透传（真 bash，接线断言）', () => {
  function runNormalize(stdoutFile, providerExit) {
    const out = path.join(workdir, 'receipt.json');
    runBash(
      ['detect_structured_terminal', 'normalize_provider_failure'],
      `normalize_provider_failure '${out}' 'attempt-r80' 'claude' '' '' false '${providerExit}' '${stdoutFile}'`,
    );
    return JSON.parse(fs.readFileSync(out, 'utf8'));
  }

  it('B1 结构化 BLOCKED + CONTRACT_* 且 CLI 退出码非零 → 回执 error.code 保真为真因，不写 provider_exit（RED 核心）', () => {
    const f = tmpJson('b1.json', { status: 'blocked', error: { code: 'CONTRACT_SELF_CONTRADICTION' } });
    const receipt = runNormalize(f, 1);
    expect(receipt.error.code).toBe('CONTRACT_SELF_CONTRADICTION');
    expect(receipt.status).toBe('blocked');
  });

  it('B2 无结构化产出的真崩溃 + CLI 退出码非零 → 仍 provider_exit / failed（负向语义不变）', () => {
    const f = tmpJson('b2.txt', 'panic: runtime error\n');
    const receipt = runNormalize(f, 1);
    expect(receipt.error.code).toBe('provider_exit');
    expect(receipt.status).toBe('failed');
  });

  it('B3 provider 超时（exit 124）→ 仍 provider_timeout（负向语义不变，不被结构化探测改写）', () => {
    const f = tmpJson('b3.txt', 'anything\n');
    const receipt = runNormalize(f, 124);
    expect(receipt.error.code).toBe('provider_timeout');
    expect(receipt.status).toBe('failed');
  });
});
