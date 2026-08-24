// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：runner 声明的 codex 输出 schema ↔ OpenAI structured output 校验器
//
// 2026-08-24 生产实证（r67 run 10952f5f，codex team1/team2 确定性 2/2 复现）：
//   entrypoint 硬编码的 codex_output_schema 中 failure_signature 带 uniqueItems，
//   OpenAI structured output 不支持该关键字 → invalid_json_schema →
//   codex 跑 evaluator 确定性 provider_exit → 目标穷尽全 run 判死。
//   修法：schema 声明去 uniqueItems；唯一性校验由 Brain 端 execution-contract
//   的 zod refine 兜底（语义不丢，只是不再让 OpenAI 校验器见到它不认识的关键字）。
//
// 按产物闸规矩写在边上：shell 模块无法 import——照 step3-publisher-head-lag-retry
// 先例，以"原文断言"守卫 entrypoint.sh 这条 shell 边。
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ENTRYPOINT_PATH = path.join(ROOT, 'docker/cecelia-runner/entrypoint.sh');
const CONTRACT_TEST_PATH = path.join(
  ROOT,
  'docker/cecelia-runner/entrypoint-provider-contract.test.sh',
);

describe('F1 step3：codex 输出 schema 不含 OpenAI 拒绝的关键字（r67 案卷）', () => {
  it('被改模块是 shell 零件：无法作为 Node 模块加载（守卫改为原文断言）', async () => {
    await expect(import('../../../docker/cecelia-runner/entrypoint')).rejects.toThrow();
  });

  it('entrypoint 原文任何 schema 声明均不含 uniqueItems（OpenAI structured output 不支持）', () => {
    const source = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
    expect(source).not.toMatch(/uniqueItems/);
    // schema 本体仍在（零件没被误删）：failure_signature 数组约束保留
    expect(source).toMatch(/failure_signature/);
    expect(source).toMatch(/"maxItems":64|maxItems: 64/);
  });

  it('provider contract 测试串与 entrypoint 同步（不再断言 uniqueItems）', () => {
    const source = fs.readFileSync(CONTRACT_TEST_PATH, 'utf8');
    expect(source).not.toMatch(/uniqueItems/);
  });
});
