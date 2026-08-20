// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：Runner 合同物化 ↔ TDD (Red) 纯净
//
// 2026-08-20 生产实证（run ee2f9ff9 attempt 0a2c004e，r30 终态 failed 的结构根因）：
//   合同文档（contract-draft.md / contract-dod.md / sprint-prd.md）由 generator Provider
//   按 skill 冻结档指令自行落盘，随 (Red) 一起 commit → TDD 顺序闸红；
//   fix 想重排历史 → append-only 血统闸 fail-closed 死锁，run 无路可走。
//   修法 = fix 自己陈词的方案 (b)：Runner 物化全部合同产物（bundle inputs.contract_artifacts
//   里已有 canonical 字节，requireCore 保证三文档在集合内），并在血统闸安装后、Provider
//   启动前机械预提交为 `chore(harness): import contract`（TDD 闸 v5.1 已预留该豁免）。
//
// 按产物闸规矩写在边上：真 require materialize-frozen-contract-artifacts.cjs（不 mock 被改模块）；
// entrypoint 预提交函数从 entrypoint.sh 原文提取后在真 git repo 里真跑（真零件）。
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const MATERIALIZER_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../docker/cecelia-runner/materialize-frozen-contract-artifacts.cjs',
);
const ENTRYPOINT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../docker/cecelia-runner/entrypoint.sh',
);
const { materializeFrozenContractArtifacts } = require('../../../docker/cecelia-runner/materialize-frozen-contract-artifacts.cjs');

const APPROVED_SHA = 'a'.repeat(40);
const SPRINT_DIR = 'sprints/08209999-kernel-example';

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

function testArtifact(content = 'throw new Error("RED");') {
  return {
    type: 'frozen_contract_test',
    path: `${SPRINT_DIR}/tests/example.test.ts`,
    content,
    sha256: digest(content),
    source_sha: APPROVED_SHA,
  };
}

function docArtifact(name, content) {
  return {
    path: `${SPRINT_DIR}/${name}`,
    content,
    sha256: digest(content),
    byte_length: Buffer.byteLength(content),
    source_revision: APPROVED_SHA,
  };
}

const DOCS = [
  docArtifact('contract-draft.md', '# 合同正文\n'),
  docArtifact('contract-dod.md', '# Contract DoD\n- [ ] X\n'),
  docArtifact('sprint-prd.md', '# Sprint PRD\n'),
];

function envelope({ role = 'generator', artifacts = [testArtifact()], contractArtifacts = DOCS, approvedSha = APPROVED_SHA } = {}) {
  const inputs = {
    sprint_dir: SPRINT_DIR,
    contract: { approved_sha: approvedSha },
    artifacts,
  };
  if (contractArtifacts !== undefined) inputs.contract_artifacts = contractArtifacts;
  return { task_bundle: { role, inputs } };
}

let workspace;
beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'red-purity-'));
});
afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe('A. materializer 物化合同文档（inputs.contract_artifacts）', () => {
  it('A1 generator：三文档 + tests 全部落盘，内容一致，文档只读 0444', () => {
    materializeFrozenContractArtifacts(envelope(), workspace);
    for (const doc of DOCS) {
      const target = path.join(workspace, doc.path);
      expect(fs.readFileSync(target, 'utf8')).toBe(doc.content);
      expect(fs.statSync(target).mode & 0o777).toBe(0o444);
    }
    expect(fs.readFileSync(path.join(workspace, testArtifact().path), 'utf8'))
      .toBe(testArtifact().content);
  });

  it('A2 已存在但内容漂移的文档 → 拒绝（CONTRACT IS LAW 扩展到文档）', () => {
    const target = path.join(workspace, DOCS[0].path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '被 Provider 改写过的合同');
    expect(() => materializeFrozenContractArtifacts(envelope(), workspace))
      .toThrow(/diverged/);
  });

  it('A3 evaluator：候选缺文档 → 拒绝（候选必须带 import commit 的文档）', () => {
    // tests 文件先落盘（evaluator 对 tests 的存在性检查须先通过）
    const testTarget = path.join(workspace, testArtifact().path);
    fs.mkdirSync(path.dirname(testTarget), { recursive: true });
    fs.writeFileSync(testTarget, testArtifact().content);
    expect(() => materializeFrozenContractArtifacts(envelope({ role: 'evaluator' }), workspace))
      .toThrow(/missing frozen document/);
  });

  it('A4 bundle 无 contract_artifacts 字段（legacy/旧 Brain）→ 只物化 tests，不失败', () => {
    materializeFrozenContractArtifacts(envelope({ contractArtifacts: undefined }), workspace);
    expect(fs.existsSync(path.join(workspace, testArtifact().path))).toBe(true);
    expect(fs.existsSync(path.join(workspace, DOCS[0].path))).toBe(false);
  });

  it('A5 文档 path 逃逸 sprint 目录 → 拒绝', () => {
    for (const badPath of [
      'sprints/other/contract-draft.md',
      `${SPRINT_DIR}/../escape.md`,
      '/etc/passwd',
    ]) {
      const bad = { ...DOCS[0], path: badPath };
      expect(() => materializeFrozenContractArtifacts(envelope({ contractArtifacts: [bad] }), workspace))
        .toThrow();
    }
  });

  it('A6 文档 source_revision 与 approved_sha 不一致 → 拒绝', () => {
    const bad = { ...DOCS[0], source_revision: 'b'.repeat(40) };
    expect(() => materializeFrozenContractArtifacts(envelope({ contractArtifacts: [bad] }), workspace))
      .toThrow();
  });
});

describe('B. entrypoint 预提交 chore(harness): import contract（真 bash + 真 git repo）', () => {
  function extractPrecommitFn() {
    const text = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
    const match = text.match(/import_contract_artifacts_precommit\(\) \{[\s\S]*?\n\}/);
    expect(match, 'entrypoint.sh 必须定义 import_contract_artifacts_precommit()').not.toBeNull();
    return match[0];
  }

  function setupRepoWithMaterializedArtifacts() {
    execFileSync('git', ['init', '-q', '-b', 'cp-test', workspace]);
    const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
    fs.writeFileSync(path.join(workspace, 'base.txt'), 'base');
    execFileSync('git', ['-C', workspace, 'add', 'base.txt'], { env: gitEnv });
    execFileSync('git', ['-C', workspace, 'commit', '-q', '-m', 'base'], { env: gitEnv });
    materializeFrozenContractArtifacts(envelope(), workspace);
    fs.writeFileSync(path.join(workspace, 'junk.txt'), '与合同无关的杂物');
    const bundlePath = path.join(workspace, '.bundle.json');
    fs.writeFileSync(bundlePath, JSON.stringify(envelope()));
    return bundlePath;
  }

  function runPrecommit(bundlePath) {
    const script = [
      'set -uo pipefail',
      extractPrecommitFn(),
      'import_contract_artifacts_precommit "$2"',
    ].join('\n');
    execFileSync('bash', ['-c', script, 'bash', workspace, bundlePath], {
      env: { ...process.env, WORKTREE_PATH: workspace },
    });
  }

  function headSha() {
    return execFileSync('git', ['-C', workspace, 'rev-parse', 'HEAD']).toString().trim();
  }

  it('B1 物化后预提交：HEAD 前进 1，message 精确匹配，产物全 tracked、无合同 untracked', () => {
    const bundlePath = setupRepoWithMaterializedArtifacts();
    const before = headSha();
    runPrecommit(bundlePath);
    const after = headSha();
    expect(after).not.toBe(before);
    const msg = execFileSync('git', ['-C', workspace, 'log', '-1', '--format=%s']).toString().trim();
    expect(msg).toBe('chore(harness): import contract');
    const files = execFileSync('git', ['-C', workspace, 'show', '--name-only', '--format=', 'HEAD'])
      .toString().trim().split('\n').sort();
    expect(files).toEqual([
      ...DOCS.map((d) => d.path),
      testArtifact().path,
    ].sort());
    const untracked = execFileSync('git', ['-C', workspace, 'status', '--porcelain', '--untracked-files=all'])
      .toString();
    expect(untracked).not.toMatch(/sprints\//);
  });

  it('B2 幂等：第二次调用不产生新 commit', () => {
    const bundlePath = setupRepoWithMaterializedArtifacts();
    runPrecommit(bundlePath);
    const first = headSha();
    runPrecommit(bundlePath);
    expect(headSha()).toBe(first);
  });

  it('B3 与合同无关的 untracked 杂物不被卷入', () => {
    const bundlePath = setupRepoWithMaterializedArtifacts();
    runPrecommit(bundlePath);
    const untracked = execFileSync('git', ['-C', workspace, 'status', '--porcelain', '--untracked-files=all'])
      .toString();
    expect(untracked).toMatch(/\?\? junk\.txt/);
  });

  it('B4 接线：调用点在 install_frozen_baseline_guard 之后、prepare_evaluator_provider_identity 之前，且 generator-only', () => {
    const text = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
    const callNeedle = 'import_contract_artifacts_precommit "$task_bundle_file"';
    const callIdx = text.indexOf(callNeedle);
    expect(callIdx, '预提交调用点必须存在').toBeGreaterThan(-1);
    const guardIdx = text.indexOf('if ! install_frozen_baseline_guard');
    const identityIdx = text.indexOf('if ! prepare_evaluator_provider_identity');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(identityIdx).toBeGreaterThan(-1);
    // 血统闸安装时断言 HEAD==START_SHA → 预提交必须在闸安装之后（否则闸装不上）
    expect(callIdx).toBeGreaterThan(guardIdx);
    expect(callIdx).toBeLessThan(identityIdx);
    const callLine = text.slice(text.lastIndexOf('\n', callIdx) + 1, text.indexOf('\n', callIdx));
    expect(callLine).toContain('is_generator_task_bundle');
  });
});
