import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const distill = new URL('../skill-distillation/', import.meta.url);
const entry = fileURLToPath(new URL('scripts/goldset-eval.mjs', distill));
const manifest = JSON.parse(readFileSync(new URL('goldset/manifest.json', distill), 'utf8'));
const threshold = JSON.parse(readFileSync(new URL('eval-threshold.json', distill), 'utf8'));
const images = manifest.samples.map(({ file }) => readFileSync(new URL(`goldset/${file}`, distill)));
const valid = (index, wrong = []) => ({
  choices: [{ message: { content: JSON.stringify({
    ok: wrong.includes(index) ? !manifest.samples[index].expected : manifest.samples[index].expected,
    why: 'local HTTP transport fixture',
  }) } }],
});

// The subprocess executes the unchanged production CLI, parser and scoring loop.
// Only the external provider boundary is a local HTTP server; real PNGs are sent.
async function evaluate(reply, { envModel = 'local-env-model', cliModel } = {}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    requests.push({ method: request.method, url: request.url, body: JSON.parse(raw) });
    const answer = reply(requests.length - 1);
    response.writeHead(answer.status ?? 200, { 'Content-Type': 'application/json' });
    response.end(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await new Promise((resolve, reject) => {
      const args = [entry, ...(cliModel ? ['--model', cliModel] : [])];
      const child = spawn(process.execPath, args, {
        env: { ...process.env, TOAPIS_API_KEY: 'local-test-only',
          TOAPIS_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`,
          GOLDSET_EVAL_MODEL: envModel },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
    });
    expect(result.signal).toBeNull();
    expect(requests).toHaveLength(10);
    requests.forEach((request, index) => {
      expect(request.method).toBe('POST');
      expect(request.url).toBe('/v1/chat/completions');
      expect(request.body.model).toBe(cliModel ?? envModel);
      expect(request.body.stream).toBe(false);
      const image = request.body.messages[1].content.find(item => item.type === 'image_url');
      expect(Buffer.from(image.image_url.url.split(',')[1], 'base64').equals(images[index])).toBe(true);
    });
    const summary = result.stdout.match(/\{\n\s*"pass":[\s\S]*?\n\}/);
    expect(summary, result.stdout + result.stderr).not.toBeNull();
    return { ...result, summary: JSON.parse(summary[0]) };
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

describe('goldset CLI: actual parser and scoring over local HTTP and the ten original PNGs', () => {
  it.each([
    ['HTTP 403 for every image', () => ({ status: 403, body: { error: { code: 'model_not_found' } } })],
    ['empty answer for every image', () => ({ body: { choices: [{ message: { content: '' } }] } })],
    ['invalid provider JSON for every image', () => ({ body: 'not a JSON response' })],
    ['invalid judge JSON for every image', () => ({ body: { choices: [{ message: { content: '{broken' } }] } })],
    ['nonboolean verdict for every image', () => ({ body: { choices: [{ message: { content: '{"ok":"false"}' } }] } })],
  ])('%s scores zero rather than eight default-false negatives', async (_name, reply) => {
    const result = await evaluate(reply);
    expect(result.summary.pass).toBe(0);
    expect(result.summary.pass_rate).toBe(0);
    expect(result.summary.threshold).toBe(threshold.pass_rate_min);
    expect(result.code).toBe(1);
  });

  it('two invalid negative answers cannot inflate eight valid answers into a passing rate', async () => {
    const result = await evaluate(index => ({ body: [2, 3].includes(index)
      ? { choices: [{ message: { content: '' } }] } : valid(index) }));
    expect(result.summary.pass).toBe(8);
    expect(result.summary.pass_rate).toBe(0.8);
    expect(result.code).toBe(1);
  });

  it.each([[[], 10, 0], [[9], 9, 0], [[8, 9], 8, 1]])(
    'valid verdicts retain the original 0.9 threshold (wrong samples %j)', async (wrong, pass, code) => {
      const result = await evaluate(index => ({ body: valid(index, wrong) }));
      expect(threshold.pass_rate_min).toBe(0.9);
      expect(result.summary.pass).toBe(pass);
      expect(result.summary.pass_rate).toBe(pass / 10);
      expect(result.summary.threshold).toBe(0.9);
      expect(result.summary.model).toBe('local-env-model');
      expect(result.code).toBe(code);
    });

  it('explicit CLI model overrides the environment and reaches every HTTP request', async () => {
    const result = await evaluate(index => ({ body: valid(index) }), {
      envModel: 'local-env-model', cliModel: 'local-cli-model',
    });
    expect(result.summary.model).toBe('local-cli-model');
    expect(result.summary.pass).toBe(10);
    expect(result.code).toBe(0);
  });
});
