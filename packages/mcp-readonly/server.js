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
import { assertReadonly } from './src/self-check.js';
import { AlertTracker, sendBarkAlert, defaultRestartLogPath } from './src/alerting.js';

const execFileAsync = promisify(execFile);

// Task 14 Bark 告警：单个模块级 AlertTracker，跟着进程生命周期走（不是每次
// createApp() 调用都新建一个——测试里 createApp() 会被反复调用，但告警阈值
// 状态理应是"这个进程"级别的，不是"这次 app 装配"级别的）。sendBark 钩子
// 抄自 packages/brain/src/notifier.js 的 sendBark() 写法，见 src/alerting.js
// 顶部注释；这里只是把标题固定成服务名。
const alertTracker = new AlertTracker({
  sendBark: (message) => sendBarkAlert('Cecelia MCP Readonly', message),
});

// 把 db.js 的 query() 包一层 DB 故障告警埋点："连续3次DB查询失败触发Bark"/
// "失败后一次成功即重置计数"这两条规则由 AlertTracker.recordDbFailure() /
// recordDbSuccess() 自己实现，这里只负责把每一次真实查询的成功/失败结果喂
// 给它。用包装函数而不是直接改 db.js 的 query()，是因为 db.js 是所有只读
// 查询的公共基础设施（自己有锁定的 db.test.js），本次任务只是给"调用点"加
// 一层观测，不该改变 query() 本身的语义或签名；trackedQuery 对外的行为跟原始
// query() 完全一致（同样的参数、同样的返回值、失败时同样原样 throw），调用方
// （tool 模块）无感知。
function makeTrackedQuery(rawQuery, tracker) {
  return async function trackedQuery(pool, sql, params, opts) {
    try {
      const result = await rawQuery(pool, sql, params, opts);
      tracker.recordDbSuccess();
      return result;
    } catch (err) {
      await tracker.recordDbFailure();
      throw err;
    }
  };
}

// map_projection_runs 同一 scope_key 同一时刻最多一条 active（唯一部分索引，
// 见 map-summary.js 顶部注释），取最新 activated_at 即为"当前生效"的 run。
// 查不到时返回 null（不是 undefined）——但注意这个 null 只代表"系统当前没有
// active run"这一件事，不代表调用方想跨全部历史查询，两者不能混为一谈，见
// withActiveRun() 的处理。
async function getActiveRunId(pool, queryFn) {
  const result = await queryFn(
    pool,
    `SELECT id FROM map_projection_runs WHERE status = 'active' ORDER BY activated_at DESC LIMIT 1`,
    []
  );
  return result.rows[0]?.id ?? null;
}

// map-nodes-edges.js 里 activeRunId 的语义是三态的：undefined=拒绝（调用方没想清楚）、
// null=调用方有意跨全部历史查询、具体 id=限定某次 run。但 get_map_nodes/get_map_edges
// 的 inputSchema 根本没有暴露参数让 Notion AI 表达"我要查全部历史"这个意图——所以
// 唯一会走到 getActiveRunId() 返回 null 的场景，就是"系统当前没有 active projection
// run"这个退化态，不是有意选择。如果这里直接把 null 转发给 getMapNodes/getMapEdges，
// 会安静触发它们的"跨全部历史查询"分支，把历史上所有（含已废弃 run 的）节点/边当
// 正常结果返回给 Notion AI，且没有任何标记说明"这不是当前状态快照"——跟
// get_map_summary 遇到同样情况时显式返回 projection_status:'none' 的做法不一致。
// 所以在这一层就把"没有 active run"和"调用方明确要查全部历史"分开处理：前者直接
// 短路返回空结果 + no_active_run 标记，不真的去查历史数据；后置的 computeFn 参数
// 只在确实存在 active run 时才会被调用，因此永远不会把 null 传给 getMapNodes/
// getMapEdges——它们的 undefined fail-closed 分支目前也不会被这里触发到。
async function withActiveRun(pool, queryFn, computeFn) {
  const activeRunId = await getActiveRunId(pool, queryFn);
  if (activeRunId === null) {
    return { rows: [], no_active_run: true };
  }
  const result = await computeFn(activeRunId);
  return { rows: result.rows };
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
// 本次组装不改它的实现，只如实记录这个风险。不修的原因不是"怕破坏测试"——
// getDeploymentStatus 是依赖注入设计，换一个 execFn/新增查询源不需要碰现成测试；
// 真正的原因是更可靠的实现（改查 Brain 自己的 /api/brain/health 拿 git_sha）需要
// 新建一个前置任务（Task 1-10）未交付的 HTTP 查询模块，超出 Task 11"组装现成模块"
// 的范围，留给后续任务处理。
async function gitExecFn(cmd) {
  const [command, ...args] = cmd.split(' ');
  return execFileAsync(command, args);
}

function buildMcpServer({ pool, startedAt, queryFn }) {
  const server = new McpServer({ name: 'cecelia-readonly', version: '1.0.0' });

  server.registerTool(
    'get_schema_version',
    {
      description: '返回当前最高 schema/migration 版本',
      inputSchema: {},
    },
    async () => ({
      content: [{ type: 'text', text: JSON.stringify(await getSchemaVersion(pool, queryFn)) }],
    })
  );

  server.registerTool(
    'get_map_summary',
    {
      description: '返回 active manifest、projection 状态和四类对象数量',
      inputSchema: {},
    },
    async () => ({
      content: [{ type: 'text', text: JSON.stringify(await getMapSummary(pool, queryFn)) }],
    })
  );

  server.registerTool(
    'get_map_nodes',
    {
      description: `按 node_type 查询 map_projection_nodes（仅当前 active run），node_type 合法值：${NODE_TYPES.join('/')}`,
      inputSchema: { node_type: z.string(), limit: z.number().optional() },
    },
    async ({ node_type, limit }) => {
      const payload = await withActiveRun(pool, queryFn, (activeRunId) =>
        getMapNodes(pool, queryFn, { node_type, limit }, NODE_TYPES, activeRunId)
      );
      return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
    }
  );

  server.registerTool(
    'get_map_edges',
    {
      description: `按 edge_type 查询 map_projection_edges（仅当前 active run），edge_type 合法值：${EDGE_TYPES.join('/')}`,
      inputSchema: { edge_type: z.string(), limit: z.number().optional() },
    },
    async ({ edge_type, limit }) => {
      const payload = await withActiveRun(pool, queryFn, (activeRunId) =>
        getMapEdges(pool, queryFn, { edge_type, limit }, EDGE_TYPES, activeRunId)
      );
      return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
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
  const trackedQuery = makeTrackedQuery(query, alertTracker);

  const mcpServer = buildMcpServer({ pool, startedAt, queryFn: trackedQuery });

  app.use(
    '/mcp',
    bearerAuth(bearerToken, { onFailure: (token) => alertTracker.recordAuthFailure(token) }),
    createRateLimiter({
      windowMs: 60_000,
      max: 20,
      onRateLimited: (token) => alertTracker.recordRateLimited(token),
    })
  );

  app.post('/mcp', async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => transport.close());
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // 重启风暴检测（Task 14）：故意放在自检之前、整个启动流程最开头。原因：
  // 如果这台服务反复崩溃重启的根因恰好是自检本身持续失败（比如
  // MCP_READONLY_DATABASE_URL 配错、账号权限被意外改写），那"1小时内重启
  // >3次"这个信号最有价值的时刻就是自检失败导致的 crash loop——放在自检
  // 之后就永远等不到这次机会。recordRestartPersisted 内部对文件读写失败
  // 已经做了容错（不会抛出、不会阻塞），不会拖慢正常启动。
  await alertTracker.recordRestartPersisted(defaultRestartLogPath());

  // 启动自检（Task 12，见 src/self-check.js）：用一条独立、短生命周期的连接池探测
  // mcp_readonly 账号是不是真的只读，探测完立刻关闭——不复用 createApp() 内部会
  // 建的那个服务用连接池，两者职责分开：这里只负责"敢不敢启动"，服务用连接池的
  // 生命周期跟着 app 走。自检失败（账号意外可写，或探测本身出了意外错误）时打印
  // 清晰的中文错误信息并以非零状态码退出，不能带病启动。
  const selfCheckPool = createReadonlyPool(process.env.MCP_READONLY_DATABASE_URL, { max: 1 });
  try {
    await assertReadonly((sql) => query(selfCheckPool, sql, []));
  } catch (err) {
    console.error(`[mcp-readonly] 启动自检失败，拒绝启动：${err.message}`);
    await selfCheckPool.end();
    process.exit(1);
  }
  await selfCheckPool.end();

  const app = createApp();
  const port = process.env.MCP_PORT || 8787;
  app.listen(port, () => {
    console.log(`mcp-readonly listening on :${port}`);
  });
}
