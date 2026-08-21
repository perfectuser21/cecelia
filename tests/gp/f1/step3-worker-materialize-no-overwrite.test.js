// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：worker 物化 ↔ evaluator 候选完整性
//
// 2026-08-21 生产实证（run 08b3b2b5，r40）：fix 首次干净通过全部复核后，evaluator prepare
// 阶段 worker 的 materializeContractArtifacts 对全部 contract_artifacts 无条件 O_TRUNC
// 覆盖——把候选里 fix 勾过的 contract-dod.md（[x]）回写成封印版（[ ]）→ runner 的
// candidate tree assertion 正确报 drift（M contract-dod.md, 9+/9-）→ evaluator 两连死。
// 修：worker 只补缺失文件（generator 全新工作区）；已存在文件的一致性由 runner
// materializer（含 checkbox 豁免）与树断言权威校验。
//
// 按产物闸规矩写在边上：真 require attempt-runner.cjs（不 mock 被改模块）。
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { materializeContractArtifacts } = require('../../../packages/brain/scripts/fleet-worker/attempt-runner.cjs').__test__;

const art = (p, content) => ({
  path: p, content,
  sha256: createHash('sha256').update(content).digest('hex'),
  byte_length: Buffer.byteLength(content),
  source_revision: 'b'.repeat(40),
});

describe('worker 物化只补缺失（r40 evaluator 候选回写案卷）', () => {
  it('r40 形态：候选 [x] 版不被封印 [ ] 版覆盖', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wnt-'));
    const rel = 'sprints/x/contract-dod.md';
    fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
    fs.writeFileSync(path.join(ws, rel), '- [x] [ARTIFACT] 已完成');
    materializeContractArtifacts(ws, [art(rel, '- [ ] [ARTIFACT] 已完成')]);
    expect(fs.readFileSync(path.join(ws, rel), 'utf8')).toBe('- [x] [ARTIFACT] 已完成');
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it('缺失文件照常物化写入（generator 场景不变）', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wnt-'));
    materializeContractArtifacts(ws, [art('sprints/x/tests/a.test.ts', 'RED')]);
    expect(fs.readFileSync(path.join(ws, 'sprints/x/tests/a.test.ts'), 'utf8')).toBe('RED');
    fs.rmSync(ws, { recursive: true, force: true });
  });
});
