#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function digest(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * 物化并验真冻结合同产物（tests + 文档）。
 *
 * - `inputs.artifacts[]`（frozen_contract_test）：Provider 前落盘 / Provider 后复验，原有行为。
 * - `inputs.contract_artifacts[]` 非 tests 条目（contract-draft.md / contract-dod.md /
 *   sprint-prd.md，Brain 封印集 requireCore 保证齐全）：同强度校验后落盘（wx, 0444）。
 *   Red 纯净化（r30 结构根因，attempt 0a2c004e 方案 b）：文档由 Runner 物化并预提交，
 *   Provider 不再自行落盘 → (Red) 不混入合同文档。
 *   字段缺席（legacy / 旧 Brain bundle）→ 文档步跳过，向后兼容。
 *
 * 校验失败一律 throw；CLI 入口负责转译为 stderr + exit 1（行为与旧版一致）。
 */
function materializeFrozenContractArtifacts(envelope, workspacePath) {
  const bundle = envelope?.task_bundle;
  const role = bundle?.role;
  if (!['generator', 'evaluator'].includes(role)) return { skipped: true };
  const inputs = bundle?.inputs;
  const artifacts = inputs?.artifacts;
  const sprintDir = inputs?.sprint_dir;
  const approvedSha = inputs?.contract?.approved_sha;
  if ((!Array.isArray(artifacts) || artifacts.length === 0) && approvedSha == null) {
    return { legacy: true, role };
  }
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error('frozen test artifacts missing');
  }
  if (typeof sprintDir !== 'string' || !sprintDir || sprintDir.includes('\\')
      || sprintDir.startsWith('/') || sprintDir.split('/').includes('..')) {
    throw new Error('invalid sprint directory');
  }
  if (!/^[a-f0-9]{40}$/.test(approvedSha ?? '')) throw new Error('approved SHA missing');

  const workspace = path.resolve(workspacePath);
  const sprintRoot = `${sprintDir.replace(/\/$/, '')}/`;
  const prefix = `${sprintRoot}tests/`;
  const seen = new Set();
  for (const artifact of artifacts) {
    if (artifact?.type !== 'frozen_contract_test'
        || typeof artifact.path !== 'string'
        || !artifact.path.startsWith(prefix)
        || artifact.path.includes('\\')
        || artifact.path.split('/').includes('..')
        || typeof artifact.content !== 'string'
        || !/^[a-f0-9]{64}$/.test(artifact.sha256 ?? '')
        || artifact.source_sha !== approvedSha
        || seen.has(artifact.path)) {
      throw new Error('invalid frozen test descriptor');
    }
    seen.add(artifact.path);
    if (digest(artifact.content) !== artifact.sha256) {
      throw new Error(`digest mismatch: ${artifact.path}`);
    }
    const target = path.resolve(workspace, artifact.path);
    if (!target.startsWith(`${workspace}${path.sep}`)) {
      throw new Error(`path escaped workspace: ${artifact.path}`);
    }

    if (fs.existsSync(target)) {
      const existing = fs.readFileSync(target, 'utf8');
      if (existing !== artifact.content) throw new Error(`frozen test diverged: ${artifact.path}`);
    } else if (role === 'evaluator') {
      throw new Error(`candidate PR is missing frozen test: ${artifact.path}`);
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, artifact.content, { encoding: 'utf8', flag: 'wx', mode: 0o444 });
    }
  }

  let documentCount = 0;
  const contractArtifacts = inputs?.contract_artifacts;
  if (Array.isArray(contractArtifacts) && contractArtifacts.length > 0) {
    const documents = contractArtifacts.filter(
      (doc) => !(typeof doc?.path === 'string' && doc.path.includes('/tests/')),
    );
    const docSeen = new Set();
    for (const doc of documents) {
      if (typeof doc?.path !== 'string'
          || !doc.path.startsWith(sprintRoot)
          || doc.path.includes('\\')
          || doc.path.split('/').includes('..')
          || typeof doc.content !== 'string'
          || !/^[a-f0-9]{64}$/.test(doc.sha256 ?? '')
          || doc.source_revision !== approvedSha
          || docSeen.has(doc.path)) {
        throw new Error('invalid frozen document descriptor');
      }
      docSeen.add(doc.path);
      if (digest(doc.content) !== doc.sha256) {
        throw new Error(`digest mismatch: ${doc.path}`);
      }
      const target = path.resolve(workspace, doc.path);
      if (!target.startsWith(`${workspace}${path.sep}`)) {
        throw new Error(`path escaped workspace: ${doc.path}`);
      }

      if (fs.existsSync(target)) {
        const existing = fs.readFileSync(target, 'utf8');
        if (existing !== doc.content) {
          throw new Error(`frozen contract document diverged: ${doc.path}`);
        }
      } else if (role === 'evaluator') {
        throw new Error(`candidate PR is missing frozen document: ${doc.path}`);
      } else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, doc.content, { encoding: 'utf8', flag: 'wx', mode: 0o444 });
      }
      documentCount += 1;
    }
  }

  return { role, testCount: artifacts.length, documentCount };
}

function fail(message) {
  process.stderr.write(`[frozen-contract-artifacts] ${message}\n`);
  process.exit(1);
}

function main() {
  const [bundlePath, workspacePath] = process.argv.slice(2);
  if (!bundlePath || !workspacePath) fail('bundle and workspace are required');

  let envelope;
  try {
    envelope = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  } catch (error) {
    fail(`invalid TaskBundle envelope: ${error.message}`);
  }

  let result;
  try {
    result = materializeFrozenContractArtifacts(envelope, workspacePath);
  } catch (error) {
    fail(error.message);
  }
  if (result.skipped) return;
  if (result.legacy) {
    process.stdout.write(`[frozen-contract-artifacts] legacy ${result.role} has no managed contract\n`);
    return;
  }
  process.stdout.write(
    `[frozen-contract-artifacts] verified ${result.testCount} tests and ${result.documentCount} documents for ${result.role}\n`,
  );
}

if (require.main === module) main();

module.exports = { materializeFrozenContractArtifacts };
