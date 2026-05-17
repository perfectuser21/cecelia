#!/usr/bin/env node
/**
 * trigger-w8v18-child.cjs
 *
 * sprints/w8-langgraph-v18 ws1 合同 step (3) 的实施代码：
 * 在 Generator 容器内 POST 给 Brain /api/brain/tasks 创建一个最小子
 * harness_initiative，请求体携带 metadata.parent_initiative_id 与
 * child_prd_path，让 Brain LangGraph 自主跑完 5 节点。
 *
 * 设计要点：
 *   - 纯 stdlib，零外部依赖（容器内 npm install 受限）
 *   - 默认走 process.env.BRAIN_URL；DRY_RUN=1 时只打印 payload 不真请求
 *   - 失败时退出码 1 + stderr 写错误，便于 Generator 容器 fail-fast
 *   - 不读 packages/brain/src/，符合"只读 Brain 合同"的硬约束
 *
 * 用法：
 *   PARENT_INITIATIVE_ID=98aef732-... \
 *   CHILD_PRD_PATH=sprints/w8-langgraph-v18/child-prd.md \
 *   BRAIN_URL=http://host.docker.internal:5221 \
 *   node packages/engine/scripts/harness/trigger-w8v18-child.cjs
 *
 *   # 干跑（不真请求，仅打印请求 body 给操作员复核）
 *   DRY_RUN=1 PARENT_INITIATIVE_ID=98aef732-... \
 *     CHILD_PRD_PATH=sprints/w8-langgraph-v18/child-prd.md \
 *     node packages/engine/scripts/harness/trigger-w8v18-child.cjs
 *
 * 退出码：
 *   0 — 触发成功（DRY_RUN 也算成功），stdout 为 child task id JSON
 *   1 — 输入缺失 / 文件读失败 / Brain HTTP 非 2xx
 */

'use strict';

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(msg) {
  process.stderr.write(`trigger-w8v18-child: ${msg}\n`);
  process.exit(1);
}

function readEnv() {
  const parentId = process.env.PARENT_INITIATIVE_ID || '';
  const childPrdPath =
    process.env.CHILD_PRD_PATH || 'sprints/w8-langgraph-v18/child-prd.md';
  const brainUrl = process.env.BRAIN_URL || 'http://host.docker.internal:5221';
  const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

  if (!UUID_V4.test(parentId)) {
    fail(
      `PARENT_INITIATIVE_ID 必须是 UUID v4 格式，实际收到: "${parentId || '<empty>'}"`
    );
  }
  if (!fs.existsSync(childPrdPath)) {
    fail(
      `CHILD_PRD_PATH 文件不存在: ${childPrdPath} — 合同 risk 1 mitigation 要求 ws1 先写 child-prd.md`
    );
  }

  return { parentId, childPrdPath, brainUrl, dryRun };
}

function buildPayload({ parentId, childPrdPath }) {
  const prdText = fs.readFileSync(childPrdPath, 'utf8');
  return {
    task_type: 'harness_initiative',
    title: '[W8 v18 child] 真端到端最小验证 — append README timestamp',
    priority: 'P1',
    payload: { prd_text: prdText },
    metadata: {
      parent_initiative_id: parentId,
      child_prd_path: childPrdPath,
      sprint: 'w8-langgraph-v18',
      workstream: 'ws1',
      origin: 'trigger-w8v18-child.cjs',
    },
  };
}

function postJson(brainUrl, payload) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL('/api/brain/tasks', brainUrl);
    } catch (e) {
      reject(new Error(`BRAIN_URL 不是合法 URL: ${brainUrl} (${e.message})`));
      return;
    }

    const body = JSON.stringify(payload);
    const opts = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const lib = url.protocol === 'https:' ? https : http;

    const req = lib.request(opts, (res) => {
      let chunks = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        chunks += c;
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode || 0, body: chunks });
      });
    });
    req.on('error', reject);
    req.setTimeout(15_000, () => {
      req.destroy(new Error('Brain POST 超时 15s'));
    });
    req.write(body);
    req.end();
  });
}

async function main() {
  const env = readEnv();
  const payload = buildPayload(env);

  if (env.dryRun) {
    process.stdout.write(
      JSON.stringify({ dry_run: true, payload }, null, 2) + '\n'
    );
    return;
  }

  const res = await postJson(env.brainUrl, payload);
  if (res.statusCode < 200 || res.statusCode >= 300) {
    fail(
      `Brain POST /api/brain/tasks 非 2xx：status=${res.statusCode} body=${res.body.slice(0, 500)}`
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch (e) {
    fail(`Brain 响应不是合法 JSON: ${res.body.slice(0, 500)}`);
  }

  const childId = parsed && (parsed.id || (parsed.task && parsed.task.id));
  if (!childId || !UUID_V4.test(childId)) {
    fail(
      `Brain 响应缺少 child task id (UUID v4)：${JSON.stringify(parsed).slice(0, 500)}`
    );
  }

  process.stdout.write(
    JSON.stringify({
      status: 'created',
      child_initiative_id: childId,
      parent_initiative_id: env.parentId,
      child_prd_path: env.childPrdPath,
    }) + '\n'
  );
}

main().catch((err) => fail(err && err.message ? err.message : String(err)));
