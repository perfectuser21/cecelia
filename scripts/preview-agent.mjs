#!/usr/bin/env node
/**
 * MMV历史预览管理与自有npm缓存回收代理。
 * 共享preview路由的旧start/allocate已返回410；保留身份、状态与历史停止接口。
 * cache路由只按受保护的intent处理既有资源，并提供持久回执。
 * 启动必须有部署令牌，默认回环监听；启动不生产磁盘样本或注册采样时钟。
 */
import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import previewRoutes from '../packages/brain/src/routes/preview.js';
import { createCacheRouter } from './preview-cache/router.mjs';
import { loadDeployToken, describeTokenSource, resolveReleaseSha } from './preview-agent/deploy-token.mjs';

// 端口选 5241 而非邻近号段：5221 是 socat（转发 us-vps），5231 已被 fleet-node-health
// 占用（2026-09-17 实测返回 {"error":"not_found"}，且 lsof 在普通权限下看不到它）。
// 换端口前请先 curl 探一下，别只信 lsof。
const PORT = Number(process.env.PREVIEW_AGENT_PORT || 5241);
// 默认只听回环；生产由 launchd 传 Tailscale 地址进来。绝不默认 0.0.0.0。
const HOST = process.env.PREVIEW_AGENT_HOST || '127.0.0.1';

const deployToken = loadDeployToken();
if (!deployToken.token) {
  console.error(`[preview-agent] 缺 DEPLOY_TOKEN（${describeTokenSource(deployToken)}）—— 拒绝启动。`);
  console.error('  历史资源停止与缓存回收接口必须有鉴权。');
  console.error('  修法：凭据文件（DEPLOY_TOKEN_FILE，默认 ~/.credentials/cecelia-deploy-token.env）写一行');
  console.error('  DEPLOY_TOKEN=<与 GitHub secret 同值>，权限 600；不要再写进 plist。');
  process.exit(1);
}
// routes/preview.js 的 checkDeployToken 在每次请求时读 process.env.DEPLOY_TOKEN（缺失=放行），
// 所以必须在开始监听前把文件里的令牌放进本进程环境——否则等于关了鉴权。
process.env.DEPLOY_TOKEN = deployToken.token;
console.log(`[preview-agent] 部署令牌来源：${describeTokenSource(deployToken)}`);

const AGENT_DIR = dirname(fileURLToPath(import.meta.url));
// 运行身份供健康检查读回，git_sha 必须绑定实际运行快照。
const GIT_SHA = resolveReleaseSha({ root: join(AGENT_DIR, '..') });
const app = express();
app.use(express.json({ limit: '1mb' }));

// 保留共享历史管理接口与MMV专属缓存回收接口。
app.use('/api/brain/preview/janitor/cache', createCacheRouter());
app.use('/api/brain/preview', previewRoutes);

// 健康读回实际快照身份及进程存续时间，不作为业务完成凭据。
const startedAt = Date.now();
app.get('/api/brain/health', (_req, res) => {
  res.json({
    status: 'healthy',
    role: 'preview-agent',
    host: 'mmv',
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
    git_sha: GIT_SHA,
  });
});

app.use((err, _req, res, _next) => {
  console.error('[preview-agent] 未捕获错误:', err?.message);
  res.status(500).json({ error: 'preview_agent_error', detail: err?.message });
});

app.listen(PORT, HOST, () => {
  console.log(`[preview-agent] 监听 ${HOST}:${PORT} —— 历史预览管理与自有缓存回收`);
});
