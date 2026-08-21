// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：合同文档不可变复核 ↔ DoD 完成状态生命周期
//
// 2026-08-21 生产实证（run 00e0d542 attempt 28dd21b6，r34 第五层）：generator-fix 为通过
// dod-format-check / harness-contract-lint 把 contract-dod.md 的 `- [ ]` 勾成 `- [x]`，
// 被 post-provider 文档不可变复核拦（frozen contract document diverged）。结构根因：
// 条目**内容**不可变正确（CONTRACT IS LAW），完成状态翻转是 DoD 的固有生命周期——
// CI 门禁本来就要求实现后全勾。复核规则缺一个精确豁免。
//
// 修法：materializer 文档比对对 contract-dod.md 允许 checkbox-only 翻转——逐行同位置
// `- [ ]` → `- [x]`（含缩进/[ARTIFACT]/[BEHAVIOR] 前缀行），其余任何差异（改文本/删行/
// 加行/反向 [x]→[ ]）照拒。防拆闸负向用例同写。
//
// 按产物闸规矩写在边上：真 require materialize-frozen-contract-artifacts.cjs（不 mock）。
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { materializeFrozenContractArtifacts } = require('../../../docker/cecelia-runner/materialize-frozen-contract-artifacts.cjs');

const APPROVED = 'a'.repeat(40);
const SPRINT = 'sprints/08219999-kernel-x';
const DOD_SEALED = [
  '# Contract DoD — Sprint X',
  '',
  '## ARTIFACT 条目',
  '',
  '- [ ] [ARTIFACT] diff-gate.js 含确定性分支',
  '  Test: node -e "process.exit(0)"',
  '',
  '- [ ] [BEHAVIOR] [L2] B-01: 确定性透传',
  '  预期观察: retryable=false',
].join('\n');

function digest(c) { return createHash('sha256').update(c).digest('hex'); }
function doc(name, content) {
  return { path: `${SPRINT}/${name}`, content, sha256: digest(content), byte_length: Buffer.byteLength(content), source_revision: APPROVED };
}
function envelope() {
  const testContent = 'throw new Error("RED");';
  return { task_bundle: { role: 'generator', inputs: {
    sprint_dir: SPRINT,
    contract: { approved_sha: APPROVED },
    artifacts: [{ type: 'frozen_contract_test', path: `${SPRINT}/tests/a.test.ts`, content: testContent, sha256: digest(testContent), source_sha: APPROVED }],
    contract_artifacts: [doc('contract-draft.md', '# 合同'), doc('contract-dod.md', DOD_SEALED), doc('sprint-prd.md', '# PRD')],
  } } };
}

let ws;
beforeEach(() => { ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dod-exempt-')); });
afterEach(() => { fs.rmSync(ws, { recursive: true, force: true }); });

function materializeThenMutateDod(mutate) {
  materializeFrozenContractArtifacts(envelope(), ws);
  const p = path.join(ws, SPRINT, 'contract-dod.md');
  fs.chmodSync(p, 0o644);
  fs.writeFileSync(p, mutate(DOD_SEALED));
  return () => materializeFrozenContractArtifacts(envelope(), ws);
}

describe('contract-dod.md checkbox-only 豁免（r34 fix 死循环回归）', () => {
  it('r34 形态：全部 - [ ] 勾成 - [x] → 复核通过（完成状态是生命周期不是改合同）', () => {
    const run = materializeThenMutateDod((s) => s.replaceAll('- [ ]', '- [x]'));
    expect(run).not.toThrow();
  });

  it('部分勾选（只勾一条）→ 同样通过', () => {
    const run = materializeThenMutateDod((s) => s.replace('- [ ] [ARTIFACT]', '- [x] [ARTIFACT]'));
    expect(run).not.toThrow();
  });

  it('防拆闸：改条目文本 → 照拒 diverged', () => {
    const run = materializeThenMutateDod((s) => s.replace('确定性透传', '想改就改'));
    expect(run).toThrow(/diverged/);
  });

  it('防拆闸：勾选的同时顺手改文本 → 照拒', () => {
    const run = materializeThenMutateDod((s) => s.replaceAll('- [ ]', '- [x]').replace('retryable=false', 'retryable=true'));
    expect(run).toThrow(/diverged/);
  });

  it('防拆闸：删行/加行 → 照拒', () => {
    expect(materializeThenMutateDod((s) => s + '\n- [x] [ARTIFACT] 私自加的条目')).toThrow(/diverged/);
  });

  it('防拆闸：contract-draft.md 不享受豁免（任何改动照拒）', () => {
    materializeFrozenContractArtifacts(envelope(), ws);
    const p = path.join(ws, SPRINT, 'contract-draft.md');
    fs.chmodSync(p, 0o644);
    fs.writeFileSync(p, '# 合同 - [x] 改了');
    expect(() => materializeFrozenContractArtifacts(envelope(), ws)).toThrow(/diverged/);
  });
});
