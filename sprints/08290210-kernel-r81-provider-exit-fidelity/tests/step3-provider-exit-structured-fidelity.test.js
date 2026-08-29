// F1「工厂 · 开发闭环」步骤 3「造完真验」——「结构化上报保真透传，根除 provider_exit 语义埋没 [r81]」
//
// 冻结 RED（本 sprint 唯一封印测试，seal 闸 assertTestContractResolvable 校验此路径）。
// 复刻三生产实证：
//   - r77 attempt e022a331 / r76：执行体写出 success 结果 JSON，进程以非零码退出，
//     回执被覆盖成 provider_exit（失败不留原因病族）。
//   - r69 attempt 56a09164：结构化 BLOCKED + CONTRACT_* 错误码被判 provider_exit，
//     kernel 误当基础设施崩溃、进 failed_targets、不走合同故障重开。
//
// 两个埋没点各一组断言，真 import / 真跑「被改的那条边」，禁 mock：
//   ① packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs 的 close-result 解析
//      （真调其内部 parseHarnessResult，不 mock）——待被改模块导出纯函数
//      resolveProviderCloseResult({ exitCode, resultPath, attemptId }）。
//   ② docker/cecelia-runner/entrypoint.sh 的 normalize_provider_failure（真跑该 bash 函数，
//      读真实 result.json，不 mock），沿用仓库既有 entrypoint 函数抽取+spawnSync 范式。
//
// 负向 / 铁律：无结构化产出（真崩溃）仍 provider_exit / provider_result_invalid；
// exit 124 仍 provider_timeout —— 语义不变。
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const ENTRYPOINT_PATH = path.join(REPO_ROOT, 'docker/cecelia-runner/entrypoint.sh');
const HANDLER = require(path.join(
  REPO_ROOT,
  'packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs',
));

const ATTEMPT_ID = '56a09164-1111-4111-8111-111111111111';

function successResult(attemptId = ATTEMPT_ID) {
  return {
    contract_version: '1.0',
    attempt_id: attemptId,
    status: 'completed',
    summary: 'generator produced a git candidate',
    artifacts: [],
    checks: [],
    decision: null,
    error: null,
    provider_metadata: { provider: 'claude' },
  };
}

function contractBlockedResult(attemptId = ATTEMPT_ID) {
  return {
    contract_version: '1.0',
    attempt_id: attemptId,
    status: 'blocked',
    summary: 'contract test is unsatisfiable',
    artifacts: [],
    checks: [],
    decision: null,
    error: { code: 'CONTRACT_TEST_UNSATISFIABLE', message: 'RED placeholder is a stub' },
    provider_metadata: { provider: 'claude' },
  };
}

function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r81-fidelity-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---- ① kernel-attempt-handler close-result 解析 ----------------------------------

describe('r81 埋没点① kernel-attempt-handler close-result 保真透传', () => {
  it('导出纯函数 resolveProviderCloseResult（可离线重放的被改边）', () => {
    expect(typeof HANDLER.resolveProviderCloseResult).toBe('function');
  });

  it('非零退出 + 结构化 success result → 透传 completed，非 provider_exit（r77/r76）', () => {
    withTmpDir((dir) => {
      const resultPath = path.join(dir, 'result.json');
      fs.writeFileSync(resultPath, JSON.stringify(successResult()));
      const out = HANDLER.resolveProviderCloseResult({
        exitCode: 1,
        resultPath,
        attemptId: ATTEMPT_ID,
      });
      expect(out.status).toBe('completed');
      expect(out.error).toBeNull();
    });
  });

  it('非零退出 + 结构化 BLOCKED + CONTRACT_* → 保真透传 error.code（r69）', () => {
    withTmpDir((dir) => {
      const resultPath = path.join(dir, 'result.json');
      fs.writeFileSync(resultPath, JSON.stringify(contractBlockedResult()));
      const out = HANDLER.resolveProviderCloseResult({
        exitCode: 1,
        resultPath,
        attemptId: ATTEMPT_ID,
      });
      expect(out.status).toBe('blocked');
      expect(out.error?.code).toBe('CONTRACT_TEST_UNSATISFIABLE');
    });
  });

  it('负向：无 result.json（真崩溃）→ provider_exit_${code} 语义不变', () => {
    withTmpDir((dir) => {
      const resultPath = path.join(dir, 'missing.json');
      const out = HANDLER.resolveProviderCloseResult({
        exitCode: 3,
        resultPath,
        attemptId: ATTEMPT_ID,
      });
      expect(out.status).toBe('failed');
      expect(out.error?.code ?? out.error).toBe('provider_exit_3');
    });
  });

  it('负向：exit 0 + 非法 result.json → provider_result_invalid 语义不变', () => {
    withTmpDir((dir) => {
      const resultPath = path.join(dir, 'result.json');
      fs.writeFileSync(resultPath, '{ not valid harness result }');
      const out = HANDLER.resolveProviderCloseResult({
        exitCode: 0,
        resultPath,
        attemptId: ATTEMPT_ID,
      });
      expect(out.status).toBe('failed');
      expect(out.error?.code ?? out.error).toBe('provider_result_invalid');
    });
  });
});

// ---- ② entrypoint.sh normalize_provider_failure（真跑 bash 函数） ----------------

function extractNormalizeFn() {
  const src = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
  const m = src.match(/^normalize_provider_failure\(\) \{[\s\S]+?^\}/m);
  if (!m) throw new Error('normalize_provider_failure() not found in entrypoint.sh');
  return m[0];
}

// 运行真实 bash 函数：normalized_file attempt provider session cred cred_mutated exit stdout [result_file]
// result_file 作为第 9 位参数注入（被改边新增的结构化终态前置读取入参）。
function runNormalize({ resultJson, exitCode }) {
  return withTmpDir((dir) => {
    const normalized = path.join(dir, 'normalized.json');
    const stdout = path.join(dir, 'stdout.txt');
    // 良性崩溃 stdout（无 auth/login 语义），使无结构化产出的负向路径确定性落 provider_exit。
    fs.writeFileSync(stdout, 'provider process crashed unexpectedly\n');
    const resultPath = path.join(dir, 'result.json');
    let resultArg = '';
    if (resultJson !== undefined) {
      fs.writeFileSync(resultPath, JSON.stringify(resultJson));
      resultArg = resultPath;
    }
    const fnBody = extractNormalizeFn();
    const wrapper = [
      'set -o pipefail',
      fnBody,
      `normalize_provider_failure ${JSON.stringify(normalized)} ${JSON.stringify(ATTEMPT_ID)} `
        + `claude '' '' false ${exitCode} ${JSON.stringify(stdout)} ${JSON.stringify(resultArg)}`,
    ].join('\n');
    const res = spawnSync('bash', ['-c', wrapper], { encoding: 'utf8' });
    if (res.status !== 0) {
      throw new Error(`bash normalize failed: ${res.status} ${res.stderr}`);
    }
    return JSON.parse(fs.readFileSync(normalized, 'utf8'));
  });
}

describe('r81 埋没点② entrypoint normalize_provider_failure 保真透传', () => {
  it('埋没点② 非零退出 + 结构化 success result → 透传 completed，不覆盖 provider_exit（r77/r76）', () => {
    const out = runNormalize({ resultJson: successResult(), exitCode: 1 });
    expect(out.status).toBe('completed');
  });

  it('埋没点② 非零退出 + 结构化 BLOCKED + CONTRACT_* → 保真透传 error.code（r69）', () => {
    const out = runNormalize({ resultJson: contractBlockedResult(), exitCode: 1 });
    expect(out.status).toBe('blocked');
    expect(out.error?.code).toBe('CONTRACT_TEST_UNSATISFIABLE');
  });

  it('埋没点② 负向：无 result.json（真崩溃）→ provider_exit 语义不变', () => {
    const out = runNormalize({ resultJson: undefined, exitCode: 1 });
    expect(out.status).toBe('failed');
    expect(out.error?.code).toBe('provider_exit');
  });

  it('埋没点② 铁律：exit 124（超时）→ provider_timeout 语义不变', () => {
    const out = runNormalize({ resultJson: successResult(), exitCode: 124 });
    expect(out.error?.code).toBe('provider_timeout');
  });
});
