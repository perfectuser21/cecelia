import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
const entry = fileURLToPath(new URL('../../brain-deploy-preflight.mjs', import.meta.url));
export const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
export async function fixture(t, { certified = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'brain-preflight-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, 'init', '-q', '-b', 'cp-fixture'); git(root, 'config', 'core.hooksPath', join(root, '.git', 'hooks')); git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'user.name', 'Fixture'); git(root, 'config', 'core.filemode', 'true');
  const put = async (path, text = 'initial') => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); };
  const commit = () => { git(root, 'add', '-A'); git(root, 'commit', '-qm', 'fixture'); return git(root, 'rev-parse', 'HEAD'); };
  await put('packages/brain/server.js'); await put('.prd.md'); await put('scripts/ops/us-vps/opc-watchdog.sh');
  if (certified) await certify(root);
  const a = commit();
  const receipt = { deployment_id: '12345678-1234-4234-9234-123456789abc', outcome: 'success',
    git_sha: a, image_id: 'sha256:' + 'a'.repeat(64), container_id: 'b'.repeat(64), version: '1.2.3', confirmed_at: '2026-11-25T00:00:00.000Z',
    business_readback: { protocol: 'brain-release-readback/v1', status: 'passed', container_id: 'b'.repeat(64), task_count: 0, task_sample_sha256: 'e'.repeat(64), scope: 'read_only', external_services: 'not_evaluated' } };
  const state = { status: 'idle', git_sha: a, settled: true, settlement: receipt };
  const health = { status: 'healthy', git_sha: a, version: '1.2.3', runtime: { isolated: false, background_automation: true } };
  const ledger = join(root, 'ledger.json'); await writeFile(ledger, JSON.stringify(receipt));
  // Native read-only ledger remains separate from the fixture repository commits.
  git(root, 'config', 'core.excludesFile', join(root, '.git', 'exclude-fixture'));
  await writeFile(join(root, '.git', 'exclude-fixture'), 'ledger.json\nreport*.json\ngithub-output\n');
  const calls = []; let statusReads = 0;
  const server = createServer((req, res) => {
    calls.push([req.method, req.url]);
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    const value = req.url === '/api/brain/deploy/status' ? (statusReads++, state) : req.url === '/api/brain/health' ? health : null;
    if (!value) { res.writeHead(404); res.end(); return; }
    if (f.respond) { f.respond(req, res, value, statusReads); return; }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const f = { root, a, put, commit, state, receipt, health, calls, ledger, respond: null,
    async run(target = git(root, 'rev-parse', 'HEAD'), extra = [], env = {}) {
      const output = join(root, 'report.json'), github = join(root, 'github-output');
      await rm(output, { force: true }); await rm(github, { force: true });
      const child = spawn(process.execPath, [entry, '--repo-root', root, '--target', target,
        '--brain-url', `http://127.0.0.1:${server.address().port}`, '--output', output, ...extra],
      { env: { ...process.env, GITHUB_OUTPUT: github, FORCE_BRAIN_DEPLOY: '', ...env } });
      let stdout = '', stderr = ''; child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
      const code = await new Promise(resolve => child.on('close', resolve));
      let report = null; try { report = JSON.parse(await readFile(output, 'utf8')); } catch {}
      return { code, stdout, stderr, report, github: await readFile(github, 'utf8').catch(() => '') };
    } };
  return f;
}
export async function assertDecision(f, wanted, target) {
  const before = await readFile(f.ledger);
  const result = await f.run(target);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.report?.deploy_required, wanted, '真实发布决策不符合业务边界');
  assert.match(result.github, new RegExp(`^deploy_required=${wanted}$`, 'm'));
  assert.deepEqual(await readFile(f.ledger), before);
  assert.equal(f.calls.filter(([method]) => method !== 'GET').length, 0);
  return result.report;
}

export const certificatePath = 'scripts/ci/brain-deploy-certification.json';
export const certificateSchema = 'brain-deploy-certification/v1';
export const certificatePolicy = 'brain-deploy-git-tree-five-paths-v1';
// Independent fixture oracle uses Git's staged immutable tree; it never calls production code.
export function consumerDigest(root) {
  git(root, 'add', '-A'); const tree = git(root, 'write-tree');
  const bytes = execFileSync('git', ['ls-tree','-rz','--full-tree',tree], { cwd: root });
  const skipped = ['.prd.md','.dod.md','DoD.md','scripts/ops/us-vps/opc-watchdog.sh',
    'scripts/ops/__tests__/watchdog/retired-brief.test.sh',certificatePath];
  const records = []; let offset = 0;
  while (offset < bytes.length) {
    const end = bytes.indexOf(0,offset), tab = bytes.indexOf(9,offset);
    const path = bytes.subarray(tab+1,end);
    if (!skipped.some(p => Buffer.from(p).equals(path))) records.push(bytes.subarray(offset,end+1));
    offset = end+1;
  }
  return createHash('sha256').update(Buffer.concat(records)).digest('hex');
}
export async function certify(root) {
  const value = { schema: certificateSchema, policy_id: certificatePolicy, consumer_tree_sha256: consumerDigest(root) };
  await mkdir(dirname(join(root,certificatePath)), { recursive: true });
  await writeFile(join(root,certificatePath), JSON.stringify(value)+'\n'); return value;
}
export function runtime(f, sha) { f.state.git_sha = sha; f.receipt.git_sha = sha; f.health.git_sha = sha; }
