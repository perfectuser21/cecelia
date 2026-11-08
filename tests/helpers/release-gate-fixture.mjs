import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const guard = fileURLToPath(new URL('./release-gate-network-guard.cjs', import.meta.url));

export async function createReleaseGateFixture(repoRoot) {
  const owned = mkdtempSync(resolve(tmpdir(), 'release-gate-http-'));
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString('utf8') });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
  } catch (error) {
    rmSync(owned, { recursive: true, force: true });
    throw error;
  }
  const origin = `http://127.0.0.1:${server.address().port}`;
  let sequence = 0;
  return {
    async runGate(args) {
      const start = requests.length;
      const log = resolve(owned, `network-${sequence++}.jsonl`);
      // 继承的生产地址与Node注入项不能决定测试目标；CLI仍是原始产品脚本。
      const env = { ...process.env, BRAIN_URL: origin, RELEASE_GATE_TEST_ORIGIN: origin,
        RELEASE_GATE_NETWORK_LOG: log, NODE_OPTIONS: `--require=${guard}` };
      delete env.NODE_TEST_CONTEXT;
      const result = await new Promise((resolveResult, reject) => {
        const child = spawn(process.execPath, [resolve(repoRoot, 'scripts/release-gate.mjs'), ...args], {
          cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '', stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        const timer = setTimeout(() => child.kill(), 5000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('close', code => {
          clearTimeout(timer);
          resolveResult({ exitCode: code ?? -1, stdout, stderr });
        });
      });
      assert.equal(existsSync(log) ? readFileSync(log, 'utf8') : '', '', 'CLI尝试访问非owned网络');
      return { ...result, requests: requests.slice(start) };
    },
    async close() {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      rmSync(owned, { recursive: true, force: true });
    },
  };
}
