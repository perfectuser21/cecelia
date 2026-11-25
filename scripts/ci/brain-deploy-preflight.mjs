#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const CERT_PATH = 'scripts/ci/brain-deploy-certification.json';
const CERT_SCHEMA = 'brain-deploy-certification/v1';
const CERT_POLICY = 'brain-deploy-git-tree-five-paths-v1';
const DOCS = new Set(['.prd.md', '.dod.md', 'DoD.md']);
const OPS = new Set(['scripts/ops/us-vps/opc-watchdog.sh', 'scripts/ops/__tests__/watchdog/retired-brief.test.sh']);
const fail = code => { throw new Error(code); };

// All commands address immutable commits; no fetch, checkout, receipt write or deployment.
function git(repoRoot, args, timeout) {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    timeout, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1' },
  });
}
async function jsonGet(url, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'error', signal: controller.signal });
    if (!response.ok) fail('http_unavailable');
    const chunks = []; let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 1024 * 1024) { controller.abort(); fail('response_too_large'); }
      chunks.push(chunk);
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('invalid_json_shape');
    return parsed;
  } finally { clearTimeout(timer); }
}
function identity(status, health) {
  const receipt = status.settlement, business = receipt?.business_readback;
  if (!['idle', 'success', 'succeeded'].includes(status.status) || status.settled !== true
      || !receipt || receipt.outcome !== 'success' || !SHA.test(status.git_sha ?? '')
      || receipt.git_sha !== status.git_sha || !/^sha256:[a-f0-9]{64}$/.test(receipt.image_id ?? '')
      || !HEX64.test(receipt.container_id ?? '') || !UUID.test(receipt.deployment_id ?? '')
      || !VERSION.test(receipt.version ?? '') || typeof receipt.confirmed_at !== 'string'
      || !Number.isFinite(Date.parse(receipt.confirmed_at))) fail('native_unsettled');
  if (business?.protocol !== 'brain-release-readback/v1' || business.status !== 'passed'
      || business.scope !== 'read_only' || business.container_id !== receipt.container_id
      || business.external_services !== 'not_evaluated' || !Number.isSafeInteger(business.task_count)
      || business.task_count < 0 || business.task_count > 1 || !HEX64.test(business.task_sample_sha256 ?? '')) fail('business_unverified');
  if (health.status !== 'healthy' || health.git_sha !== receipt.git_sha || health.version !== receipt.version
      || health.runtime?.isolated !== false || health.runtime?.background_automation !== true) fail('health_unverified');
  return {
    git_sha: receipt.git_sha, image_id: receipt.image_id, container_id: receipt.container_id,
    deployment_id: receipt.deployment_id, version: receipt.version, confirmed_at: receipt.confirmed_at,
  };
}
function parseTree(bytes) {
  const entries = []; let offset = 0;
  while (offset < bytes.length) {
    const end = bytes.indexOf(0, offset), tab = bytes.indexOf(9, offset);
    if (end < 0 || tab < offset || tab >= end) fail('invalid_git_tree');
    const header = bytes.subarray(offset, tab).toString('ascii');
    const match = /^(\d{6}) (blob|tree|commit) ([a-f0-9]{40})$/.exec(header);
    if (!match) fail('invalid_git_tree');
    const path = bytes.subarray(tab + 1, end);
    entries.push({ mode: match[1], type: match[2], oid: match[3], path, raw: bytes.subarray(offset, end + 1) });
    offset = end + 1;
  }
  return entries;
}
function projection(repoRoot, sha, timeout) {
  const entries = parseTree(git(repoRoot, ['ls-tree', '-rz', '--full-tree', sha], timeout));
  const included = [], all = new Map(), excluded = new Set();
  for (const entry of entries) {
    const key = entry.path.toString('hex'), name = entry.path.toString('utf8');
    all.set(key, entry);
    // Byte equality prevents malformed UTF-8 paths being mistaken for policy names.
    const exact = Buffer.from(name).equals(entry.path);
    let certified = exact && entry.type === 'blob' && OPS.has(name) && ['100644', '100755'].includes(entry.mode);
    if (exact && entry.type === 'blob' && DOCS.has(name) && entry.mode === '100644') {
      const content = git(repoRoot, ['cat-file', 'blob', entry.oid], timeout);
      try { new TextDecoder('utf-8', { fatal: true }).decode(content); certified = !content.includes(0); } catch { certified = false; }
    }
    if (certified) excluded.add(key); else included.push(entry.raw);
  }
  const consumer = included.filter(raw => {
    const tab = raw.indexOf(9); return !raw.subarray(tab + 1, raw.length - 1).equals(Buffer.from(CERT_PATH));
  });
  return { hash: createHash('sha256').update(Buffer.concat(included)).digest('hex'),
    consumerHash: createHash('sha256').update(Buffer.concat(consumer)).digest('hex'), all, excluded };
}
function certification(repoRoot, tree, timeout) {
  const entry = tree.all.get(Buffer.from(CERT_PATH).toString('hex'));
  if (!entry || entry.type !== 'blob' || entry.mode !== '100644') fail('certification_unavailable');
  const size = Number(git(repoRoot, ['cat-file', '-s', entry.oid], timeout).toString().trim());
  if (!Number.isSafeInteger(size) || size < 1 || size > 65536) fail('certification_unavailable');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(git(repoRoot, ['cat-file', 'blob', entry.oid], timeout))); }
  catch { fail('certification_unavailable'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'consumer_tree_sha256,policy_id,schema'
      || value.schema !== CERT_SCHEMA || value.policy_id !== CERT_POLICY
      || !HEX64.test(value.consumer_tree_sha256 ?? '')) fail('certification_unavailable');
  return { value, oid: entry.oid };
}
function changedExclusions(baseline, target) {
  const result = [];
  for (const key of new Set([...baseline.all.keys(), ...target.all.keys()])) {
    const before = baseline.all.get(key), after = target.all.get(key);
    if (before?.raw.equals(after?.raw ?? Buffer.alloc(0))) continue;
    if ((!before || baseline.excluded.has(key)) && (!after || target.excluded.has(key))) {
      result.push((before ?? after).path.toString('utf8'));
    }
  }
  return result.sort();
}
export async function runPreflight({ repoRoot, target, brainUrl, force = false, requestTimeoutMs = 10000, gitTimeoutMs = 10000 }) {
  const report = { schema: 'brain-deploy-preflight/v1', action: 'deploy', deploy_required: true,
    target_sha: target, actual_runtime_sha: null, observed_at: [],
    host_ops_installation: 'not_evaluated', external_services: 'not_evaluated',
    certification_status: 'unavailable' };
  try {
    if (force) fail('forced');
    if (!SHA.test(target ?? '')) fail('invalid_target');
    const baseUrl = new URL(brainUrl);
    if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) fail('invalid_brain_url');
    const observe = async () => {
      const status = await jsonGet(new URL('/api/brain/deploy/status', baseUrl), requestTimeoutMs);
      const health = await jsonGet(new URL('/api/brain/health', baseUrl), requestTimeoutMs);
      const id = identity(status, health); report.observed_at.push(new Date().toISOString());
      return { id, receipt: status.settlement };
    };
    const first = await observe(); report.actual_runtime_sha = first.id.git_sha;
    if (git(repoRoot, ['rev-parse', '--verify', 'HEAD^{commit}'], gitTimeoutMs).toString().trim() !== target) fail('head_target_mismatch');
    for (const sha of [target, first.id.git_sha]) {
      if (git(repoRoot, ['rev-parse', '--verify', `${sha}^{commit}`], gitTimeoutMs).toString().trim() !== sha) fail('unknown_commit');
    }
    git(repoRoot, ['merge-base', '--is-ancestor', first.id.git_sha, target], gitTimeoutMs);
    const baseline = projection(repoRoot, first.id.git_sha, gitTimeoutMs);
    const current = projection(repoRoot, target, gitTimeoutMs);
    // A successful deployment never renews this source audit certificate. Any new
    // consumer/control-plane change expires it until an explicitly reviewed update.
    report.observed_consumer_tree_sha256 = current.consumerHash;
    report.baseline_consumer_tree_sha256 = baseline.consumerHash;
    const baselineCert = certification(repoRoot, baseline, gitTimeoutMs);
    const targetCert = certification(repoRoot, current, gitTimeoutMs);
    Object.assign(report, { certification_schema: targetCert.value.schema,
      certification_policy_id: targetCert.value.policy_id,
      certification_consumer_tree_sha256: targetCert.value.consumer_tree_sha256 });
    if (baselineCert.oid !== targetCert.oid) fail('certification_changed');
    if (baseline.consumerHash !== baselineCert.value.consumer_tree_sha256
        || current.consumerHash !== targetCert.value.consumer_tree_sha256) {
      report.certification_status = 'expired'; fail('certification_expired');
    }
    report.certification_status = 'valid';
    const second = await observe();
    if (JSON.stringify(first.id) !== JSON.stringify(second.id)) fail('runtime_drift');
    if (baseline.hash !== current.hash) fail('brain_projection_changed');
    Object.assign(report, { action: first.id.git_sha === target ? 'already_current' : 'no_brain_change',
      deploy_required: false, native_identity: first.id, native_receipt: first.receipt,
      baseline_tree_hash: baseline.hash, target_tree_hash: current.hash,
      certified_excluded_changed_paths: changedExclusions(baseline, current), reason: 'stable_native_proof' });
  } catch (error) {
    // Do not copy subprocess output, network bodies, credentials or arbitrary paths into logs.
    const known = new Set(['forced','invalid_target','invalid_brain_url','head_target_mismatch','unknown_commit',
      'runtime_drift','brain_projection_changed','native_unsettled','business_unverified','health_unverified',
      'http_unavailable','response_too_large','invalid_json_shape','invalid_git_tree',
      'certification_unavailable','certification_changed','certification_expired']);
    report.reason = known.has(error.message) ? error.message : 'preflight_unavailable';
  }
  return report;
}
function options(args) {
  const result = {};
  const keys = { '--repo-root': 'repoRoot', '--target': 'target', '--brain-url': 'brainUrl', '--output': 'output',
    '--request-timeout-ms': 'requestTimeoutMs', '--git-timeout-ms': 'gitTimeoutMs' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--force') { result.force = true; continue; }
    const key = keys[args[i]];
    if (!key || i + 1 >= args.length) fail('invalid_arguments');
    result[key] = args[++i];
  }
  for (const key of ['requestTimeoutMs', 'gitTimeoutMs']) {
    if (result[key] === undefined) continue;
    result[key] = Number(result[key]);
    if (!Number.isSafeInteger(result[key]) || result[key] < 1 || result[key] > 30000) fail('invalid_budget');
  }
  if (!result.output) fail('missing_report_path');
  result.force ||= process.env.FORCE_BRAIN_DEPLOY === '1';
  return result;
}
async function main() {
  try {
    const config = options(process.argv.slice(2));
    const report = await runPreflight(config);
    // Persist the evidence before allowing a no-deploy branch; write failures are fatal.
    await writeFile(config.output, JSON.stringify(report, null, 2) + '\n');
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `deploy_required=${report.deploy_required}\n`);
    process.stdout.write(`Brain发布预检 action=${report.action} deploy_required=${report.deploy_required} reason=${report.reason}\n`);
  } catch {
    process.stderr.write('Brain发布预检未能保存有效报告或输出。\n'); process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
