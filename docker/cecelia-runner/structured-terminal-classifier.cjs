'use strict';

// F1「工厂 · 开发闭环」步骤 3（r78）——runner 回执归一化结构化终态识别 SSOT。
//
// 病根三实证：执行体产出了结构化终态（claude 成功结果 JSON / commander 成功指令 /
// 结构化 BLOCKED + CONTRACT_* 错误码），但回执归一化在 provider 进程 exit≠0 时无条件
// 降级包装为 provider_exit，导致原因病族丢失、成功结果被吞、内核按 infrastructure 重试。
//
// 修法：把「结构化终态识别 → 保真透传 vs 降级 provider_exit」抽为纯函数 SSOT，供
// docker/cecelia-runner/entrypoint.sh（bash→node）与 vitest 共用同一判定，消除双写漂移。
//
// 铁律：
//   - [语义字段判成功] 成功/终态判定看语义字段（.status ∈ 终态枚举 / subtype=success /
//     .schema=commander-directive/v1），非仅字段存在性或 ok:true——垃圾结构不得误判透传。
//   - [失败契约显式 else] 无可识别的结构化终态时显式返回 passthrough=false + failureCode，不静默。
//   - exit code 与结构化终态矛盾时（exit≠0 但产出为已验证的结构化终态），以结构化终态为准。

// 与 harness result schema 终态 status 枚举对齐（entrypoint.sh 终端回执校验、GAN 各角色共用）。
const TERMINAL_STATUS_ENUM = new Set([
  'completed',
  'completed_with_concerns',
  'needs_context',
  'blocked',
]);

// 无结构化产出的真崩溃/超时映射：exit 124=进程超时，其余非零=进程崩溃。
function providerFailureCode(providerExit) {
  return Number(providerExit) === 124 ? 'provider_timeout' : 'provider_exit';
}

/**
 * 识别 provider stdout 结构化终态，决定保真透传还是降级 provider_exit。
 *
 * @param {object} args
 * @param {number} args.providerExit provider 进程退出码。
 * @param {object|null} args.structuredResult 从 result_file 提取的结构化产出（无则 null）。
 * @param {boolean} args.commanderContract 是否 commander 契约（成功判据为 commander-directive/v1）。
 * @returns {{passthrough:true,status:string,errorCode:(string|null)}
 *          |{passthrough:false,failureCode:string}}
 */
function classifyProviderTerminal({ providerExit, structuredResult, commanderContract } = {}) {
  // 无结构化产出（null / 非对象 / 数组）→ 真崩溃，落 provider_exit / provider_timeout。
  if (
    structuredResult == null
    || typeof structuredResult !== 'object'
    || Array.isArray(structuredResult)
  ) {
    return { passthrough: false, failureCode: providerFailureCode(providerExit) };
  }

  // commander 成功指令：schema=commander-directive/v1（或 claude 结果 JSON subtype=success）→ 透传成功。
  if (
    commanderContract
    && (structuredResult.schema === 'commander-directive/v1' || structuredResult.subtype === 'success')
  ) {
    return { passthrough: true, status: 'completed', errorCode: null };
  }

  // claude 成功结果 JSON（type=result, subtype=success，即便 provider 进程 exit≠0）→ 透传成功。
  if (structuredResult.type === 'result' && structuredResult.subtype === 'success') {
    return { passthrough: true, status: 'completed', errorCode: null };
  }

  // 结构化终态：.status ∈ 终态枚举 → 保真透传；BLOCKED 保留 error.code 病族（不被 provider_exit 抹平）。
  const status = structuredResult.status;
  if (typeof status === 'string' && TERMINAL_STATUS_ENUM.has(status)) {
    const errorCode = status === 'blocked'
      ? (structuredResult.error && structuredResult.error.code) || null
      : null;
    return { passthrough: true, status, errorCode };
  }

  // 显式 else：无可识别的结构化终态语义字段（垃圾结构 {foo:1} 等）→ 不透传，落 provider_exit / provider_timeout。
  return { passthrough: false, failureCode: providerFailureCode(providerExit) };
}

module.exports = { classifyProviderTerminal };

// CLI 模式（entrypoint.sh bash→node 接线）：读取 result_file 提取结构化产出，
// 调用同一纯函数 SSOT，把决策 JSON 打到 stdout 供 bash 判 passthrough。
if (require.main === module) {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    opts[args[i]] = args[i + 1];
  }
  const resultFile = opts['--result-file'];
  const providerExit = Number(opts['--provider-exit'] ?? 1);
  const commanderContract = String(opts['--commander-contract'] ?? 'false') === 'true';
  let structuredResult = null;
  if (resultFile) {
    try {
      structuredResult = JSON.parse(require('fs').readFileSync(resultFile, 'utf8'));
    } catch (_e) {
      structuredResult = null;
    }
  }
  const decision = classifyProviderTerminal({ providerExit, structuredResult, commanderContract });
  process.stdout.write(JSON.stringify(decision));
}
