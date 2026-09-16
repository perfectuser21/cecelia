#!/usr/bin/env node
/**
 * preview-agent.mjs — MMV（执行机）侧的预览环境代理
 *
 * ── 为什么存在 ────────────────────────────────────────────────────────────
 * Deploy Preview 自 2026-09-09 Brain 搬到 us-vps 后一次没成功过
 * （preview_environments 842 次历史记录 → 归零）。挖到底是四层叠加：
 *   ① host-disk-sampler.sh 没人定时跑
 *   ② 跑了也写错地方（DEPLOY_ROOT 推断 bug，已由 #5377 修掉）
 *   ③ 采样脚本用 `df /System/Volumes/Data`，Linux 上直接不存在
 *   ④ 降级后采根分区：us-vps 根分区 24G，而门槛是 35G 底线 + 3.5G 预留 = 38.5G
 *      —— 数学上不可能通过，再怎么清理都没用
 *
 * 但真正的病根不在这四层，而在架构：**起预览环境 = 起一个 Brain 实例 + 克隆一整份
 * 数据库，这是实打实的执行活**，而 us-vps 有零执行铁律（决策 96054a8b）：只做调度，
 * 一切执行下放。整套预览功能（启动脚本硬编码 /Users/administrator 路径、磁盘门槛按
 * Mac 盘设计）本来就是为 Mac 写的，搬去 us-vps 本身就搬错了。
 *
 * ── 这个代理做什么 ────────────────────────────────────────────────────────
 * 让执行回到执行机：在 MMV 上跑，复用 routes/preview.js 的**全部**逻辑与鉴权，
 * 挂载路径与 Brain 完全一致（/api/brain/preview/*）。于是 CI 侧只需把 BRAIN_URL
 * 指向本代理——request-preview-start.sh / wait-preview-active.sh 一行都不用改，
 * 也不需要新增任何 GitHub secret（沿用早已存在的 DEPLOY_TOKEN 做 Bearer 鉴权）。
 *
 * 刻意不做的事：
 *   - 不重写一份预览逻辑。两份实现必然漂移，出事时没人知道该信哪份。
 *   - 不绑 0.0.0.0。只监听内网地址，CI 经 Tailscale 进来。
 *   - 缺 DEPLOY_TOKEN 直接拒绝启动，而不是"先跑起来再说"——没有鉴权的执行入口
 *     等于在内网裸奔，宁可起不来也不能默默敞着。
 */
import express from 'express';
import previewRoutes from '../packages/brain/src/routes/preview.js';

const PORT = Number(process.env.PREVIEW_AGENT_PORT || 5231);
// 默认只听回环；生产由 launchd 传 Tailscale 地址进来。绝不默认 0.0.0.0。
const HOST = process.env.PREVIEW_AGENT_HOST || '127.0.0.1';

if (!process.env.DEPLOY_TOKEN) {
  console.error('[preview-agent] 缺 DEPLOY_TOKEN —— 拒绝启动。');
  console.error('  预览接口能起 Brain 实例、克隆数据库，没有鉴权就是内网裸奔。');
  console.error('  修法：launchd plist 里注入 DEPLOY_TOKEN（与 GitHub secret 同值）。');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '1mb' }));

// 与 Brain 同路径挂载，CI 才能只改地址、不改调用脚本
app.use('/api/brain/preview', previewRoutes);

// CI 在调 start 之前会先探 health 拿 uptime，用于判断对端有没有中途重启
const startedAt = Date.now();
app.get('/api/brain/health', (_req, res) => {
  res.json({
    status: 'healthy',
    role: 'preview-agent',
    host: 'mmv',
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
  });
});

app.use((err, _req, res, _next) => {
  console.error('[preview-agent] 未捕获错误:', err?.message);
  res.status(500).json({ error: 'preview_agent_error', detail: err?.message });
});

app.listen(PORT, HOST, () => {
  console.log(`[preview-agent] 监听 ${HOST}:${PORT} —— 预览环境在执行机本地起，不经 us-vps`);
});
