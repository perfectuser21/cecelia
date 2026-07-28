#!/usr/bin/env node
'use strict';

const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify, TextDecoder } = require('node:util');

const execFileAsync = promisify(execFile);
const SHA = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const BRANCH = /^cp-[a-z0-9][a-z0-9._-]{0,126}$/;
const MAX_INPUT_BYTES = 1024 * 1024;
const SECRET = /(?:gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|sk-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|Authorization:\s*Bearer\s+\S+|BEGIN [A-Z ]*PRIVATE KEY)/i;

function fail(code) {
  throw new Error(code);
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(',')}}`;
}

function digest(value) {
  return createHash('sha256').update(
    Buffer.isBuffer(value) ? value : canonicalJson(value),
  ).digest('hex');
}

function exact(value, fields, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length
    || actual.some((field, index) => field !== expected[index])
  ) fail(code);
  return value;
}

function decodeJson(bytes, code) {
  if (
    !Buffer.isBuffer(bytes)
    || bytes.length < 2
    || bytes.length > MAX_INPUT_BYTES
  ) fail(code);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail(code);
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(code);
  }
}

function safeRelative(value, code) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 1024
    || value.startsWith('/')
    || /[\r\n\\\0]/.test(value)
    || value.split('/').some((part) => !part || part === '.' || part === '..')
  ) fail(code);
  return value;
}

function validatePolicy(value, state) {
  exact(value, [
    'version', 'repo', 'branch', 'base_sha', 'expected_remote_sha',
    'operation', 'pr_base', 'pr_title', 'pr_body', 'allowed_paths',
  ], 'github_mutation_policy_invalid');
  if (
    value.version !== 'github-mutation/v1'
    || value.repo !== 'perfectuser21/cecelia'
    || !BRANCH.test(value.branch)
    || value.branch.includes('..')
    || !SHA.test(value.base_sha)
    || (value.expected_remote_sha !== null && !SHA.test(value.expected_remote_sha))
    || !['push-and-create-draft', 'push-existing-draft'].includes(value.operation)
    || value.pr_base !== 'main'
    || typeof value.pr_title !== 'string'
    || value.pr_title.length < 1
    || value.pr_title.length > 256
    || /[\r\n\0]/.test(value.pr_title)
    || typeof value.pr_body !== 'string'
    || value.pr_body.length < 1
    || value.pr_body.length > 4096
    || value.pr_body.includes('\0')
    || !Array.isArray(value.allowed_paths)
    || value.allowed_paths.length < 1
    || value.allowed_paths.length > 64
  ) fail('github_mutation_policy_invalid');
  for (const entry of value.allowed_paths) {
    const normalized = entry.endsWith('/') ? entry.slice(0, -1) : entry;
    safeRelative(normalized, 'github_mutation_policy_invalid');
  }
  if (
    state?.workspace?.repo !== value.repo
    || state.workspace.branch !== value.branch
    || state.workspace.base_sha !== value.base_sha
    || state.workspace.expected_head_sha !== value.expected_remote_sha
    || state.workspace.mode !== 'read-write'
  ) fail('github_mutation_policy_binding_mismatch');
  return value;
}

function validateDeclaration(bytes, state, policy) {
  const value = decodeJson(bytes, 'github_mutation_declaration_invalid');
  const fix = policy.operation === 'push-existing-draft';
  exact(
    value,
    fix
      ? ['contract_version', 'verdict', 'branch', 'head_sha', 'fixes']
      : ['contract_version', 'verdict', 'branch', 'head_sha'],
    'github_mutation_declaration_invalid',
  );
  if (
    value.contract_version !== 'github-mutation-declaration/v1'
    || value.verdict !== (fix ? 'FIXED' : 'DONE')
    || value.branch !== policy.branch
    || !SHA.test(value.head_sha)
    || (fix && (
      !Array.isArray(value.fixes)
      || value.fixes.length < 1
      || value.fixes.length > 100
      || value.fixes.some((item) => (
        typeof item !== 'string' || item.length < 1 || item.length > 4096
      ))
    ))
  ) fail('github_mutation_declaration_invalid');
  if (state.attempt_id == null || !UUID.test(state.attempt_id)) {
    fail('github_mutation_state_invalid');
  }
  return value;
}

function recordWithDigest(record, previous) {
  const body = {
    ...record,
    previous_sha256: previous?.record_sha256 ?? null,
  };
  return Object.freeze({
    ...body,
    record_sha256: digest(body),
  });
}

function validateRecords(records, requestSha) {
  if (!Array.isArray(records) || records.length > 16) {
    fail('github_mutation_audit_invalid');
  }
  let previous = null;
  for (const record of records) {
    if (
      !record
      || record.request_sha256 !== requestSha
      || record.previous_sha256 !== (previous?.record_sha256 ?? null)
      || record.record_sha256 !== digest((({ record_sha256: _, ...rest }) => rest)(record))
    ) fail('github_mutation_audit_conflict');
    previous = record;
  }
  return records;
}

function parseNameStatus(output) {
  const tokens = String(output).split('\0');
  if (tokens.at(-1) === '') tokens.pop();
  const paths = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (!/^[AMD]$/.test(status)) fail('github_mutation_change_type_invalid');
    const changedPath = safeRelative(tokens[index++], 'github_mutation_path_invalid');
    paths.push(changedPath);
  }
  if (paths.length < 1 || paths.length > 512) {
    fail('github_mutation_changed_paths_invalid');
  }
  return paths;
}

function pathAllowed(changedPath, allowedPaths) {
  return allowedPaths.some((allowed) => (
    allowed.endsWith('/')
      ? changedPath.startsWith(allowed)
      : changedPath === allowed
  ));
}

function parseRemote(output, branch) {
  const text = String(output).trim();
  if (!text) return null;
  const lines = text.split('\n');
  if (
    lines.length !== 1
    || lines[0] !== `${lines[0].slice(0, 40)}\trefs/heads/${branch}`
    || !SHA.test(lines[0].slice(0, 40))
  ) fail('github_mutation_remote_invalid');
  return lines[0].slice(0, 40);
}

function validateTree(output, changedPaths) {
  const observed = new Map();
  for (const entry of String(output).split('\0').filter(Boolean)) {
    const match = entry.match(/^([0-9]{6}) (?:blob|commit) [a-f0-9]{40}\t(.+)$/);
    if (!match) fail('github_mutation_object_invalid');
    observed.set(match[2], match[1]);
  }
  for (const changedPath of changedPaths) {
    const mode = observed.get(changedPath);
    if (mode && !['100644', '100755'].includes(mode)) {
      fail('github_mutation_object_invalid');
    }
  }
}

function normalizePullRequest(value, policy, headSha) {
  exact(value, [
    'url', 'number', 'headRefName', 'headRefOid', 'state', 'isDraft',
  ], 'github_mutation_pr_invalid');
  let url;
  try {
    url = new URL(value.url);
  } catch {
    fail('github_mutation_pr_invalid');
  }
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.hostname !== 'github.com'
    || url.pathname !== `/perfectuser21/cecelia/pull/${value.number}`
    || !Number.isInteger(value.number)
    || value.number < 1
    || value.headRefName !== policy.branch
    || value.headRefOid !== headSha
    || value.state !== 'OPEN'
    || value.isDraft !== true
  ) fail('github_mutation_pr_invalid');
  return Object.freeze({
    type: 'pull_request',
    url: value.url,
    number: value.number,
    head_ref: value.headRefName,
    head_sha: value.headRefOid,
    state: 'OPEN',
  });
}

async function defaultTool(command, args, options) {
  const result = await execFileAsync(command, args, {
    cwd: options?.cwd,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    env: process.env,
  });
  return result.stdout;
}

function createFileGithubMutationAuditStore({ auditRoot } = {}) {
  if (
    typeof auditRoot !== 'string'
    || !path.isAbsolute(auditRoot)
    || auditRoot === path.parse(auditRoot).root
  ) fail('github_mutation_audit_root_invalid');
  const root = path.resolve(auditRoot);
  return Object.freeze({
    async read(attemptId) {
      const target = path.join(root, `${attemptId}.jsonl`);
      try {
        const stat = fs.lstatSync(target);
        if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
          fail('github_mutation_audit_invalid');
        }
        const text = fs.readFileSync(target, 'utf8');
        return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
      } catch (error) {
        if (error?.code === 'ENOENT') return [];
        if (error?.message?.startsWith('github_mutation_')) throw error;
        fail('github_mutation_audit_invalid');
      }
    },
    async append(attemptId, record) {
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      const target = path.join(root, `${attemptId}.jsonl`);
      const noFollow = fs.constants.O_NOFOLLOW ?? 0;
      const descriptor = fs.openSync(
        target,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | noFollow,
        0o600,
      );
      try {
        fs.fchmodSync(descriptor, 0o600);
        fs.writeSync(descriptor, `${canonicalJson(record)}\n`);
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      return record;
    },
  });
}

function createGithubMutationBroker({
  git = (args, options) => defaultTool('git', args, options),
  gh = (args, options) => defaultTool('gh', args, options),
  auditStore,
  finalizeRoleResult,
} = {}) {
  if (
    typeof git !== 'function'
    || typeof gh !== 'function'
    || typeof auditStore?.read !== 'function'
    || typeof auditStore?.append !== 'function'
    || typeof finalizeRoleResult !== 'function'
  ) fail('github_mutation_broker_dependency_invalid');

  function requestContext({ state, policy, declarationBytes }) {
    const parsedPolicy = validatePolicy(policy, state);
    const declaration = validateDeclaration(
      declarationBytes,
      state,
      parsedPolicy,
    );
    const requestSha = digest({
      attempt_id: state.attempt_id,
      run_id: state.run_id,
      task_id: state.task_id,
      policy: parsedPolicy,
      declaration,
    });
    return { parsedPolicy, declaration, requestSha };
  }

  function buildPrepared(input) {
    const { parsedPolicy, declaration, requestSha } = requestContext(input);
    return recordWithDigest({
      schema_version: 'github-mutation-audit/v1',
      stage: 'prepared',
      attempt_id: input.state.attempt_id,
      run_id: input.state.run_id,
      request_sha256: requestSha,
      policy_sha256: digest(parsedPolicy),
      branch: parsedPolicy.branch,
      base_sha: parsedPolicy.base_sha,
      expected_remote_sha: parsedPolicy.expected_remote_sha,
      head_sha: declaration.head_sha,
    }, null);
  }

  async function appendStage(state, records, record) {
    const complete = recordWithDigest({
      schema_version: 'github-mutation-audit/v1',
      attempt_id: state.attempt_id,
      run_id: state.run_id,
      ...record,
    }, records.at(-1) ?? null);
    await auditStore.append(state.attempt_id, complete);
    records.push(complete);
    return complete;
  }

  async function verifyWorkspace(state, policy, declaration) {
    const cwd = state.workspace.path;
    if (String(await git(['status', '--porcelain=v1', '-z'], { cwd })) !== '') {
      fail('github_mutation_workspace_dirty');
    }
    if (String(await git(['branch', '--show-current'], { cwd })).trim() !== policy.branch) {
      fail('github_mutation_branch_mismatch');
    }
    if (String(await git(['rev-parse', 'HEAD'], { cwd })).trim() !== declaration.head_sha) {
      fail('github_mutation_head_mismatch');
    }
    try {
      await git(['merge-base', '--is-ancestor', policy.base_sha, declaration.head_sha], { cwd });
    } catch {
      fail('github_mutation_base_not_ancestor');
    }
    const changedPaths = parseNameStatus(await git([
      'diff', '--name-status', '-z', `${policy.base_sha}..${declaration.head_sha}`,
    ], { cwd }));
    if (changedPaths.some((changedPath) => !pathAllowed(
      changedPath,
      policy.allowed_paths,
    ))) fail('github_mutation_path_not_allowed');
    const numstat = String(await git([
      'diff', '--numstat', '-z', `${policy.base_sha}..${declaration.head_sha}`,
    ], { cwd }));
    if (numstat.split('\0').some((entry) => entry.startsWith('-\t-\t'))) {
      fail('github_mutation_binary_invalid');
    }
    for (const tree of [declaration.head_sha, policy.base_sha]) {
      validateTree(await git(['ls-tree', '-rz', tree, '--', ...changedPaths], { cwd }), changedPaths);
    }
    const patch = String(await git([
      'diff', '--no-ext-diff', '--unified=0',
      `${policy.base_sha}..${declaration.head_sha}`, '--', ...changedPaths,
    ], { cwd }));
    if (patch.split('\n').some((line) => (
      line.startsWith('+') && !line.startsWith('+++') && SECRET.test(line.slice(1))
    ))) fail('github_mutation_secret_detected');
    const origin = String(await git(['remote', 'get-url', 'origin'], { cwd })).trim();
    if (![
      'https://github.com/perfectuser21/cecelia.git',
      'git@github.com:perfectuser21/cecelia.git',
    ].includes(origin)) fail('github_mutation_origin_invalid');
    return changedPaths;
  }

  async function inspectPr(policy, headSha, cwd) {
    const output = await gh([
      'pr', 'list',
      '--repo', policy.repo,
      '--head', policy.branch,
      '--state', 'open',
      '--limit', '2',
      '--json', 'url,number,headRefName,headRefOid,state,isDraft',
    ], { cwd });
    let rows;
    try {
      rows = JSON.parse(output);
    } catch {
      fail('github_mutation_pr_invalid');
    }
    if (!Array.isArray(rows) || rows.length > 1) fail('github_mutation_pr_invalid');
    return rows.length === 0 ? null : normalizePullRequest(rows[0], policy, headSha);
  }

  async function execute(input) {
    const {
      state,
      policy,
      declarationBytes,
      providerResultBytes,
    } = input ?? {};
    const { parsedPolicy, declaration, requestSha } = requestContext({
      state, policy, declarationBytes,
    });
    const records = validateRecords(
      await auditStore.read(state.attempt_id),
      requestSha,
    );
    let receipt = records.find((record) => record.stage === 'draft_pr_confirmed');
    if (!receipt) {
      await verifyWorkspace(state, parsedPolicy, declaration);
      let prepared = records.find((record) => record.stage === 'prepared');
      const cwd = state.workspace.path;
      let remote = parseRemote(await git([
        'ls-remote', '--heads', 'origin', `refs/heads/${parsedPolicy.branch}`,
      ], { cwd }), parsedPolicy.branch);
      if (!prepared) {
        if (remote !== parsedPolicy.expected_remote_sha) {
          fail('github_mutation_remote_lease_conflict');
        }
        prepared = buildPrepared({ state, policy: parsedPolicy, declarationBytes });
        await auditStore.append(state.attempt_id, prepared);
        records.push(prepared);
      } else if (![parsedPolicy.expected_remote_sha, declaration.head_sha].includes(remote)) {
        fail('github_mutation_remote_lease_conflict');
      }
      if (remote !== declaration.head_sha) {
        await git([
          'push',
          '--porcelain',
          `--force-with-lease=refs/heads/${parsedPolicy.branch}:${parsedPolicy.expected_remote_sha ?? ''}`,
          'origin',
          `HEAD:refs/heads/${parsedPolicy.branch}`,
        ], { cwd });
        remote = parseRemote(await git([
          'ls-remote', '--heads', 'origin', `refs/heads/${parsedPolicy.branch}`,
        ], { cwd }), parsedPolicy.branch);
        if (remote !== declaration.head_sha) fail('github_mutation_push_unconfirmed');
      }
      if (!records.some((record) => record.stage === 'push_confirmed')) {
        await appendStage(state, records, {
          stage: 'push_confirmed',
          request_sha256: requestSha,
          head_sha: declaration.head_sha,
        });
      }
      let pullRequest = await inspectPr(parsedPolicy, declaration.head_sha, cwd);
      if (!pullRequest) {
        if (parsedPolicy.operation !== 'push-and-create-draft') {
          fail('github_mutation_existing_pr_required');
        }
        await gh([
          'pr', 'create',
          '--draft',
          '--repo', parsedPolicy.repo,
          '--base', parsedPolicy.pr_base,
          '--head', parsedPolicy.branch,
          '--title', parsedPolicy.pr_title,
          '--body', parsedPolicy.pr_body,
        ], { cwd });
        pullRequest = await inspectPr(parsedPolicy, declaration.head_sha, cwd);
        if (!pullRequest) fail('github_mutation_pr_unconfirmed');
      }
      receipt = await appendStage(state, records, {
        stage: 'draft_pr_confirmed',
        request_sha256: requestSha,
        head_sha: declaration.head_sha,
        pull_request: pullRequest,
      });
    }
    const providerResult = decodeJson(
      providerResultBytes,
      'github_mutation_provider_result_invalid',
    );
    const rawEnvelope = {
      verdict: declaration.verdict,
      pr_url: receipt.pull_request.url,
      ...(declaration.verdict === 'FIXED' ? { fixes: declaration.fixes } : {}),
    };
    const result = finalizeRoleResult({
      expectedOutput: 'harness-result/generator-v1',
      binding: {
        task_id: state.task_id,
        run_id: state.run_id,
        attempt_id: state.attempt_id,
        role: 'generator',
      },
      providerResult,
      rawEnvelope,
      verifierEnvelope: {
        pull_request: receipt.pull_request,
      },
    });
    return Object.freeze({ receipt, result });
  }

  return Object.freeze({ execute, buildPrepared });
}

module.exports = {
  createFileGithubMutationAuditStore,
  createGithubMutationBroker,
};
