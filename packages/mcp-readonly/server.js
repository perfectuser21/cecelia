import express from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import { bearerAuth } from './src/auth.js';
import { createRateLimiter } from './src/rate-limit.js';
import { createReadonlyPool, query } from './src/db.js';
import { getSchemaVersion, getDeploymentStatus } from './src/tools/schema-and-deployment.js';
import { getMapSummary } from './src/tools/map-summary.js';
import { getMapNodes, getMapEdges, NODE_TYPES, EDGE_TYPES } from './src/tools/map-nodes-edges.js';
import { getServiceLogs, SERVICE_LOG_WHITELIST } from './src/tools/service-logs.js';

const execFileAsync = promisify(execFile);

// map_projection_runs 同一 scope_key 同一时刻最多一条 active（唯一部分索引，
// 见 map-summary.js 顶部注释），取最新 activated_at 即为"当前生效"的 run。
// 拿不到时传 null（跨全部 run 查询），不是 undefined ——undefined 会被
// getMapNodes/getMapEdges fail-closed 拒绝（见 map-nodes-edges.js）。
async function getActiveRunId(pool) {
  const result = await query(
    pool,
    `SELECT id FROM map_projection_runs WHERE status = 'active' ORDER BY activated_at DESC LIMIT 1`,
    []
  );
  return result.rows[0]?.id ?? null;
}

// 真实 get_service_logs readLogFn：跑 `docker logs <container> --tail <N> 2>&1`。
// docker logs 默认把容器日志写到 stderr，2>&1（这里用 execFile 的行为等价形式：
// execFile 本身分别捕获 stdout/stderr，拼一起返回）合并两路输出，容器名来自
// getServiceLogs 内部的白名单校验结果（不是调用方原始输入），lines 是已经
// clamp 过的安全整数——仍然用参数数组形式调用 execFile，不拼字符串进 shell，
// 防止未来白名单被放开成动态输入时留下注入口子。
async function dockerReadLogFn(containerName, tailLines) {
  let stdout = '';
  let stderr = '';
  try {
    const result = await execFileAsync('docker', [
      'logs',
      '--tail',
      String(tailLines),
      containerName,
    ]);
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err) {
    // docker logs 把容器自身的 stderr 输出也算作"失败但有输出"，execFile 在这种
    // 情况下会把 stdout/stderr 挂在 error 对象上而不是 resolve —— 这不代表命令语义
    // 失败（很多服务把普通日志写 stderr），照样取出内容返回，而不是把日志读取
    // 失败伪装成异常抛给上层。
    stdout = err.stdout || '';
    stderr = err.stderr || '';
  }
  const combined = `${stdout}${stderr}`;
  return combined.split('\n').filter((line) => line.length > 0);
}

// get_deployment_status 的 execFn：读宿主机仓库目录的 git 状态。
//
// 已知风险（Task 11 调查结论，未在本任务修复，见 handoff/commit message）：生产
// Cecelia Brain 现在跑在 docker-compose.yml 的 cecelia-node-brain 容器里，容器镜像
// 构建期把 GIT_SHA 烙进 Brain 自己的 /api/brain/health 响应（见
// packages/brain/scripts/smoke/git-sha-health-smoke.sh + docs/superpowers/specs/
// 2026-07-18-deploy-sha-reconcile-design.md 的 SHA 对账设计），这才是"容器里实际在
// 跑什么"的真相来源。而这里读的是宿主机磁盘 checkout 到的 commit——deploy-local.sh
// 自己的判变逻辑也不信任这个假设，专门做了 origin/main vs 生产 git_sha 的对账
// （PROD_SHA 来自 curl brain /health，不是读本地 git）。宿主机 checkout 与容器实际
// 运行版本在部署链路的中间态下可能不一致（构建了镜像但没更新 checkout，或反过来）。
// getDeploymentStatus() 本身在 Task 7 已实现并测试通过，签名是 execFn 型（git 命令），
// 本次组装不改它的实现，只如实记录这个风险；更可靠的实现应改为查询 Brain 自己的
// /health 端点，留给后续任务处理。
async function gitExecFn(cmd) {
  const [command, ...args] = cmd.split(' ');
  return execFileAsync(command, args);
}

function buildMcpServer({ pool, startedAt }) {
  const server = new McpServer({ name: 'cecelia-readonly', version: '1.0.0' });

  server.registerTool(
    'get_schema_version',
    {
      description: '返回当前最高 schema/migration 版本',
      inputSchema: {},
    },
    async () => ({
      content: [{ type: 'text', text: JSON.stringify(await getSchemaVersion(pool, query)) }],
    })
  );

  server.registerTool(
    'get_map_summary',
    {
      description: '返回 active manifest、projection 状态和四类对象数量',
      inputSchema: {},
    },
    async () => ({
      content: [{ type: 'text', text: JSON.stringify(await getMapSummary(pool, query)) }],
    })
  );

  server.registerTool(
    'get_map_nodes',
    {
      description: `按 node_type 查询 map_projection_nodes（仅当前 active run），node_type 合法值：${NODE_TYPES.join('/')}`,
      inputSchema: { node_type: z.string(), limit: z.number().optional() },
    },
    async ({ node_type, limit }) => {
      const activeRunId = await getActiveRunId(pool);
      const result = await getMapNodes(pool, query, { node_type, limit }, NODE_TYPES, activeRunId);
      return { content: [{ type: 'text', text: JSON.stringify(result.rows) }] };
    }
  );

  server.registerTool(
    'get_map_edges',
    {
      description: `按 edge_type 查询 map_projection_edges（仅当前 active run），edge_type 合法值：${EDGE_TYPES.join('/')}`,
      inputSchema: { edge_type: z.string(), limit: z.number().optional() },
    },
    async ({ edge_type, limit }) => {
      const activeRunId = await getActiveRunId(pool);
      const result = await getMapEdges(pool, query, { edge_type, limit }, EDGE_TYPES, activeRunId);
      return { content: [{ type: 'text', text: JSON.stringify(result.rows) }] };
    }
  );

  server.registerTool(
    'get_deployment_status',
    {
      description: '返回当前 commit SHA/branch/启动时间',
      inputSchema: {},
    },
    async () => ({
      content: [{ type: 'text', text: JSON.stringify(await getDeploymentStatus(gitExecFn, { startedAt })) }],
    })
  );

  server.registerTool(
    'get_service_logs',
    {
      description: `读取白名单服务日志（已脱敏），最多200行。service 合法值：${Object.keys(SERVICE_LOG_WHITELIST).join(', ')}`,
      inputSchema: { service: z.string(), lines: z.number().optional() },
    },
    async ({ service, lines }) => ({
      content: [{ type: 'text', text: JSON.stringify(await getServiceLogs(dockerReadLogFn, { service, lines })) }],
    })
  );

  return server;
}

export function createApp({ skipDbInit = false, bearerToken = process.env.MCP_BEARER_TOKEN } = {}) {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({ uptime: process.uptime() });
  });

  const pool = skipDbInit ? null : createReadonlyPool(process.env.MCP_READONLY_DATABASE_URL, { max: 5 });
  const startedAt = Date.now();

  const mcpServer = buildMcpServer({ pool, startedAt });

  app.use('/mcp', bearerAuth(bearerToken), createRateLimiter({ windowMs: 60_000, max: 20 }));

  app.post('/mcp', async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => transport.close());
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  const port = process.env.MCP_PORT || 8787;
  app.listen(port, () => {
    console.log(`mcp-readonly listening on :${port}`);
  });
}
