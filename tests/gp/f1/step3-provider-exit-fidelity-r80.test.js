// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：provider 退出归一 ↔ runner 回执保真透传
//
// Sprint r80「结构化上报保真透传，根除 provider_exit 语义埋没」补充回归行（真 bash 跑 entrypoint 原文）。
//
// 病根三实证：
//   ① r69 generator 合同死锁分析（结构化 BLOCKED + CONTRACT_*）被包装成 provider_exit（attempt 56a09164）；
//   ② r76 同类；
//   ③ r77 commander 的 claude 返回 success 结果 JSON 却被判 provider_exit failed（attempt e022a331）。
// 根因：runner/entrypoint 在 CLI 退出码非零时一律降级为 provider_exit → 真因被埋没。
//
// 按产物闸规矩写在边上：shell 模块无法 import——照 step3-red-purity-import-contract 先例，
// 从 entrypoint.sh 原文提取 detect_structured_terminal / normalize_provider_failure 在真 bash 里真跑
// （非 mock 被改模块——被改的 shell 零件原文原样运行）。
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ENTRYPOINT_PATH = path.join(ROOT, 'docker/cecelia-runner/entrypoint.sh');
const SOURCE = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');

// 从 entrypoint.sh 原文提取顶层函数块（约定：顶层函数以列首 `}` 收尾，函数体内禁列首裸 `}`）。
function extractFunction(name) {
  const match = SOURCE.match(new RegExp(`\\n${name}\\(\\) \\{[\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`entrypoint.sh 原文缺少函数 ${name}()`);
  return match[0];
}

const DETECT = extractFunction('detect_structured_terminal');
const NORMALIZE = extractFunction('normalize_provider_failure');

function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r80-fidelity-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 真 bash 跑提取的 detect_structured_terminal，返回其归一分类（trim 尾换行）。
function runDetect(stdoutContent) {
  return withTmp((dir) => {
    const stdoutFile = path.join(dir, 'stdout');
    fs.writeFileSync(stdoutFile, stdoutContent);
    const script = `set -uo pipefail\n${DETECT}\ndetect_structured_terminal "$1"\n`;
    return execFileSync('bash', ['-c', script, 'bash', stdoutFile], {
      encoding: 'utf8',
      timeout: 60_000,
    });
  });
}

// 真 bash 跑提取的 normalize_provider_failure，返回其写出的归一回执 JSON。
function runNormalize(stdoutContent, providerExit) {
  return withTmp((dir) => {
    const stdoutFile = path.join(dir, 'stdout');
    const normalizedFile = path.join(dir, 'normalized.json');
    fs.writeFileSync(stdoutFile, stdoutContent);
    const script = `set -uo pipefail\n${DETECT}\n${NORMALIZE}\n`
      + `normalize_provider_failure "$1" attempt-r80 claude "" "" false "$2" "$3"\ncat "$1"\n`;
    const out = execFileSync(
      'bash',
      ['-c', script, 'bash', normalizedFile, String(providerExit), stdoutFile],
      { encoding: 'utf8', timeout: 60_000 },
    );
    return JSON.parse(out);
  });
}

const STRUCTURED_SUCCESS = '__structured_success__';

describe('detect_structured_terminal（真 bash 跑 entrypoint 原文，6 类输入分类保真）', () => {
  it('A1 结构化 success（status=completed）→ __structured_success__', () => {
    expect(runDetect('{"status":"completed","summary":"ok","artifacts":[],"checks":[]}'))
      .toBe(STRUCTURED_SUCCESS);
  });

  it('A2 commander-directive/v1 → __structured_success__', () => {
    expect(runDetect('{"schema":"commander-directive/v1","action":"continue_default"}'))
      .toBe(STRUCTURED_SUCCESS);
  });

  it('A3 结构化 BLOCKED（error.code=CONTRACT_SELF_CONTRADICTION）→ 真因码字面保真', () => {
    // Claude 结果信封包裹结构化终态（.structured_output）也必须能透出真因码。
    expect(runDetect('{"type":"result","structured_output":{"status":"blocked","error":{"code":"CONTRACT_SELF_CONTRADICTION"}}}'))
      .toBe('CONTRACT_SELF_CONTRADICTION');
  });

  it('A4 真崩溃（无结构化产出的非 JSON stderr）→ 空（落回 provider_exit）', () => {
    expect(runDetect('Error: provider process segfault\ncore dumped')).toBe('');
  });

  it('A5 畸形/截断 JSON → 空（fail-safe，不崩溃不误判成功）', () => {
    expect(runDetect('{"status":"bl')).toBe('');
  });

  it('A6 结构化 failed → 空（不误当可透传终态，落回 provider_exit）', () => {
    expect(runDetect('{"status":"failed","error":{"code":"whatever"}}')).toBe('');
  });
});

describe('normalize_provider_failure 保真透传（真 bash 跑 entrypoint 原文）', () => {
  it('B1 结构化 BLOCKED + CONTRACT_* 且 CLI 退出码非零 → 回执 status=blocked、error.code 保真（不 provider_exit）', () => {
    const receipt = runNormalize(
      '{"status":"blocked","error":{"code":"CONTRACT_SELF_CONTRADICTION"}}',
      1,
    );
    expect(receipt.status).toBe('blocked');
    expect(receipt.error.code).toBe('CONTRACT_SELF_CONTRADICTION');
    expect(receipt.error.code).not.toBe('provider_exit');
  });
});

describe('负向语义不变（真崩溃/超时仍归基础设施，不误透传）', () => {
  it('N1 无结构化产出的真崩溃（exit 1）→ status=failed、error.code=provider_exit', () => {
    const receipt = runNormalize('Error: provider crashed with no structured output', 1);
    expect(receipt.status).toBe('failed');
    expect(receipt.error.code).toBe('provider_exit');
  });

  it('N2 exit 124 超时 → status=failed、error.code=provider_timeout', () => {
    const receipt = runNormalize('', 124);
    expect(receipt.status).toBe('failed');
    expect(receipt.error.code).toBe('provider_timeout');
  });
});
