# Design：skill-eval-worker 常驻部署 + HK /eval-api 反代 + 端到端验证

## 背景

`packages/brain/scripts/skill-eval-worker.js`（PR #3640/#3642 已合并）目前只能手动跑一次
（`node packages/brain/scripts/skill-eval-worker.js`），没有常驻服务、没有对外公网入口。
本次要把它变成"能被公网用户实际用到"的服务。

来源：Brain task `a844a24b-f25f-420a-9913-21f5e5c89e5f`，交接文档
`docs/handoffs/202607082249-skilleval-worker-atomic-claim.md`。

## 范围（本次做的 5 件事）

1. **running 超时回收器**：`skill_evals.status='running'` 且 `updated_at` 早于阈值（默认 10 分钟）→ 重置回 `pending`。worker 每次 `runOnce()` 之前先跑一次回收扫描。
2. **mmv（本机 38.23.47.81）常驻部署**：pm2 + wrapper loop 脚本反复调用 `runOnce()`（`runOnce` 跑完即退出，不能直接 `pm2 start` 裸脚本）。
3. **HK VPS `/eval-api` 反代**：SSH 到 HK VPS（`ssh root@100.86.118.99`，仅 Tailscale 可达），在现有 nginx 配置里加一个 location block，把 `/eval-api/*` 转发到 `http://38.23.47.81:5221/api/skill-eval/*`。
4. **端到端验证**：真实上传一个 skill zip → 走完整链路 → `GET /api/skill-eval/report/:task_id` 拿到正常渲染报告。
5. **真库并发冒烟**（Minor）：对真实 Postgres 插两条 pending fixture，并发调用两次 `claimPendingTask()`，确认真的互斥。

## 架构 / 数据流

```
[skill zip 上传] --POST /api/skill-eval--> Brain(mmv:5221) 写 skill_evals(pending)
                                                  │
                              pm2: eval-worker-loop (wrapper while-loop)
                                                  │
                                    回收扫描(running 超时→pending)
                                                  │
                                    claimPendingTask() FOR UPDATE SKIP LOCKED
                                                  │
                                    解压zip → spawn claude 评估 → 解析 report_data
                                                  │
                                 POST /api/skill-eval/complete (X-Eval-Proxy-Token)
                                                  │
外部用户 --公网 https://<hk-domain>/eval-api/*--> HK nginx --反代--> mmv:5221/api/skill-eval/*
```

## 各部分设计

### 1. 超时回收器

- 位置：`packages/brain/scripts/skill-eval-worker.js` 新增 `reapStaleRunning(timeoutMinutes = 10)`。
- SQL：`UPDATE skill_evals SET status='pending', updated_at=now() WHERE status='running' AND updated_at < now() - interval '<N> minutes'`。
- 调用点：`runOnce()` 开头先 `await reapStaleRunning()`，再 `claimPendingTask()`。
- 阈值来源：`env.STALE_RUNNING_TIMEOUT_MINUTES`，默认 10（单次评估实测跑 claude 一般 1-3 分钟，10 分钟留足余量）。
- 不新增表/字段——`updated_at` 已存在（migration 318），够用。

### 2. mmv 常驻部署

- 选型：**wrapper loop + pm2 fork 模式**（对齐仓库已有先例 gemini-relay/douyin-proxy），不用 `cron_restart`——wrapper 内部 `sleep 5` 轮询更直观、日志连续，pm2 只需管好这一个常驻进程的存活。
- 新增文件：`packages/brain/scripts/skill-eval-worker-loop.sh`
  ```bash
  #!/usr/bin/env bash
  while true; do
    node "$(dirname "$0")/skill-eval-worker.js"
    sleep 5
  done
  ```
- pm2 启动：`pm2 start packages/brain/scripts/skill-eval-worker-loop.sh --name skill-eval-worker`，`pm2 save`。
- 环境变量沿用 handoff 已勘查的默认值（`CLAUDE_BIN`/`CLAUDE_CONFIG_DIR`/`EVAL_PROMPT_PATH`/`EVAL_PROXY_TOKEN`/`BRAIN_BASE_URL`），通过 pm2 ecosystem 文件或 `--env` 注入，不写死进脚本。

### 3. HK /eval-api 反代 ⚠️ 高风险步骤

这一步改动 **HK 生产 VPS 的 nginx 配置**（网络配置变更），按全局安全规则须先告知风险、拿到确认才执行：
- 风险：nginx reload 失败/配置写错可能影响 HK 现有站点（ZenithJoy Dashboard 等共享同一 nginx）。
- 缓解：先 `nginx -t` 校验语法，改动只新增 location block，不动现有 server block；reload 前备份原配置。
- 鉴权：反代 location 里不暴露 `EVAL_PROXY_TOKEN`（该 token 只用于 worker→Brain 内部回调，不在公网入口路径上）；上传接口本身是否需要额外鉴权，按现有 `/api/skill-eval` 路由现状（暂无独立鉴权）保持不变，本次不新增鉴权层（超出范围）。

### 4. 端到端验证

- 用之前 Track 2 sprint 用过的示例 skill zip（如无现成的，在 worktree 内用 `zip` 命令现打一个含最小 `SKILL.md` 的包）。
- 走：`curl -F file=@xxx.zip localhost:5221/api/skill-eval` → 拿 task_id → 轮询 `GET /api/skill-eval/status/:task_id` 直到 completed → `GET /api/skill-eval/report/:task_id` 确认报告字段完整。
- 同时验证公网路径：从非 mmv 网络（或至少校验 nginx 反代规则本身）确认 `/eval-api/*` → mmv 通路可达。

### 5. 真库并发冒烟

- 写一个一次性脚本（跑完可删或放 `scripts/` 下作为手动工具）：插两条 `status=pending` fixture → `Promise.all([claimPendingTask(), claimPendingTask()])` → 断言只有一条返回非 null、另一条为 null。

## 测试策略

- **Unit**：`reapStaleRunning()` 补充到 `packages/brain/scripts/__tests__/skill-eval-worker.test.js`（mock pool，断言 SQL 语句形状 + 调用时机在 claim 之前）。
- **Integration（真库）**：第 5 项的并发冒烟脚本，接真实 Postgres（复用 `packages/brain/src/db.js` 连接）。
- **E2E（手动/脚本化）**：第 4 项，真实走完整 HTTP 链路 + claude 评估调用。
- **Manual**：pm2 部署与 nginx 反代属于运维操作，无法纳入 CI，验证方式是本次对话内的手动执行 + 观察结果（不写自动化测试）。

## 不包含

- 不新增鉴权层（如反代入口的 API key 校验）——现状本来就没有，超出本次范围。
- 不做多 worker 横向扩展（本次只部署 1 个 pm2 实例）。
- 不改 `/api/skill-eval/complete` 的 `X-Eval-Proxy-Token` 校验逻辑。

## 验收标准

- [ ] `reapStaleRunning()` 单测通过，CI 全绿
- [ ] mmv 上 `pm2 list` 显示 `skill-eval-worker` 状态 online，kill 进程后 pm2 能自动拉起
- [ ] HK `/eval-api/*` 反代生效，`curl` 能从 HK 侧转发到 mmv 并拿到响应
- [ ] 真实上传 skill zip → 全链路跑通 → report 可查
- [ ] 并发冒烟脚本确认 `claimPendingTask()` 真实互斥
