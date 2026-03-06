/**
 * Smoke Test - Brain 能启动、migrate、health check
 *
 * 真实启动 Express server（使用 CI PostgreSQL service）
 * 验证：migrate 成功 → health 200 → root 200
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.resolve(__dirname, '../../server.js');
const TEST_PORT = 15221;

function waitForServer(url, timeoutMs = 45000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = async () => {
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Server did not start within ${timeoutMs}ms`));
      }
      try {
        const res = await fetch(url);
        if (res.ok) return resolve();
      } catch {
        // not ready yet
      }
      setTimeout(check, 500);
    };
    check();
  });
}

// Smoke test requires a real PostgreSQL database (CI provides one).
// Skip locally unless DB_HOST is explicitly set.
const canRunSmoke = !!process.env.DB_HOST || !!process.env.CI;
const describeSmoke = canRunSmoke ? describe : describe.skip;

describeSmoke('Brain Smoke Test', () => {
  let serverProcess;
  let baseUrl;
  let serverOutput = '';

  beforeAll(async () => {
    baseUrl = `http://localhost:${TEST_PORT}`;

    serverProcess = spawn('node', [SERVER_PATH], {
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        NODE_ENV: 'test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    serverProcess.stdout.on('data', (d) => { serverOutput += d.toString(); });
    serverProcess.stderr.on('data', (d) => { serverOutput += d.toString(); });

    serverProcess.on('exit', (code) => {
      if (code && code !== 0 && code !== null) {
        console.error(`[smoke] Server exited with code ${code}`);
        console.error('[smoke] Output:', serverOutput.slice(-2000));
      }
    });

    await waitForServer(baseUrl);
  }, 60000);

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await new Promise((resolve) => {
        serverProcess.on('close', resolve);
        setTimeout(resolve, 3000);
      });
    }
  });

  it('migration succeeded (server started)', () => {
    // If we got here, migrations ran successfully (server.js exits on migration failure)
    expect(serverProcess.exitCode).toBeNull();
  });

  it('GET / returns 200 with service=cecelia-brain', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.service).toBe('cecelia-brain');
    expect(data.status).toBe('running');
  });

  it('GET /api/brain/health returns 200 with status field', async () => {
    const res = await fetch(`${baseUrl}/api/brain/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('status');
    expect(['healthy', 'degraded']).toContain(data.status);
  });
});
