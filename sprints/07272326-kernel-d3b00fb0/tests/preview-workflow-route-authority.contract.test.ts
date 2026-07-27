import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';

function extractStepRun(stepName: string) {
  const workflow = readFileSync('.github/workflows/preview-deploy.yml', 'utf8');
  const escaped = stepName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = workflow.match(new RegExp(`- name: ${escaped}[\\s\\S]*?run: \\|\\n([\\s\\S]*?)(?:\\n\\s*- name:|$)`));
  expect(match?.[1], `未找到 workflow step: ${stepName}`).toBeTruthy();
  return (match?.[1] ?? '').replace(/^ {10}/gm, '');
}

async function withRecorder(
  handler: (reqBody: unknown) => { status: number; body: unknown },
  run: (baseUrl: string) => void,
) {
  let receipt: { method: string; url: string; headers: Record<string, string | string[] | undefined>; body: any } | null = null;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString('utf8');
    receipt = {
      method: req.method || '',
      url: req.url || '',
      headers: req.headers,
      body: raw ? JSON.parse(raw) : null,
    };
    const out = handler(receipt.body);
    res.statusCode = out.status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(out.body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    run(baseUrl);
    return receipt;
  } finally {
    server.close();
  }
}

afterEach(() => {
  delete process.env.GITHUB_OUTPUT;
});

describe('preview workflow route authority contract [BEHAVIOR]', () => {
  it('workflow start step 保留原始 HTTP status/body 且逐项发送 authority identifiers', async () => {
    const script = extractStepRun('触发 preview-env-start（Brain API）');
    const receipt = await withRecorder(
      () => ({
        status: 200,
        body: { port: 5300, db_name: 'cecelia_preview_4372', status: 'starting' },
      }),
      (baseUrl) => {
        const result = spawnSync('bash', ['-lc', script], {
          encoding: 'utf8',
          env: {
            ...process.env,
            BRAIN_URL: baseUrl,
            DEPLOY_TOKEN: 'test-token',
            PR_NUMBER: '4372',
            BRANCH_NAME: 'cp-07271751-51836fb2',
            GITHUB_REPOSITORY: 'perfectuser21/cecelia',
            GITHUB_RUN_ID: '987654321',
            PREVIEW_TASK_ID: '11111111-1111-1111-1111-111111111111',
            PREVIEW_RUN_ID: '22222222-2222-2222-2222-222222222222',
            GITHUB_SHA: '4dc3b69aaca97e16fd4c8e28c35c4a8b6fd08f13',
            REVIEW_REQUIRED: 'true',
            GITHUB_OUTPUT: '/tmp/preview-workflow-contract-output',
          },
        });
        expect(result.status).toBe(0);
      },
    );

    expect(receipt?.method).toBe('POST');
    expect(receipt?.url).toBe('/api/brain/preview/start');
    expect(receipt?.headers.authorization).toBe('Bearer test-token');
    expect(receipt?.body).toMatchObject({
      pr_number: 4372,
      branch_name: 'cp-07271751-51836fb2',
      repository: 'perfectuser21/cecelia',
      base_repo: 'cecelia',
      workflow_run_id: 987654321,
      task_id: '11111111-1111-1111-1111-111111111111',
      run_id: '22222222-2222-2222-2222-222222222222',
      check_sha: '4dc3b69aaca97e16fd4c8e28c35c4a8b6fd08f13',
      review_required: true,
    });
  });

  it('workflow start step 在 422 时仍保留 body 与 status', async () => {
    const script = extractStepRun('触发 preview-env-start（Brain API）');
    const result = spawnSync('bash', ['-lc', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        BRAIN_URL: 'http://127.0.0.1:9',
        DEPLOY_TOKEN: 'test-token',
        PR_NUMBER: '4372',
        BRANCH_NAME: 'cp-07271751-51836fb2',
        GITHUB_OUTPUT: '/tmp/preview-workflow-contract-output-2',
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('{"error":"preview admission rejected","reason":"stale_check_sha"}');
    expect(`${result.stdout}\n${result.stderr}`).toContain('422');
  });

  it('workflow status step 保留 body 中的 status/reason', async () => {
    const script = extractStepRun('轮询 preview 状态直到 active（max 600s）');
    const receipt = await withRecorder(
      () => ({
        status: 200,
        body: { status: 'blocked', reason: 'missing_required_context' },
      }),
      (baseUrl) => {
        const result = spawnSync('bash', ['-lc', script], {
          encoding: 'utf8',
          timeout: 2_000,
          env: {
            ...process.env,
            BRAIN_URL: baseUrl,
            PR_NUMBER: '4372',
          },
        });
        expect(result.status).not.toBe(0);
        expect(`${result.stdout}\n${result.stderr}`).toContain('missing_required_context');
      },
    );

    expect(receipt?.url).toBe('/api/brain/preview/status/4372');
  });
});

