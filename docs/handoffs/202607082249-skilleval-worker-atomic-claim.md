# Handoff：skill-eval-worker 取任务原子化（PR #3642）

- verdict: PASS
- task_id: unknown（本次走 /dev 路径B，未走 Brain 有头任务登记）
- PR: https://github.com/perfectuser21/cecelia/pull/3642（已 merged，commit a164853f39cf2b44ce91ae98c7463401a6d5d262）
- branch: cp-07082150-skill-eval-worker-atomic-claim

## 完成
- `packages/brain/scripts/skill-eval-worker.js` 抽出 `claimPendingTask()`，把 `runOnce()` 取 pending 任务的两步式（SELECT 一条 + 独立 UPDATE）改成单条原子 `UPDATE ... WHERE task_id = (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING`，消除多 worker 并发轮询下重复取同一任务的竞态窗口
- 新增/加固 `packages/brain/scripts/__tests__/skill-eval-worker.test.js` 单测：SQL 语句形状断言、空结果处理、并发场景下调用次数+SQL 内容断言（防止实现退化回两步式），并修正 `vitest.config.js` 让 `scripts/**` 目录测试真正被收集执行
- 经过 TDD（Red/Green）+ 一轮任务级审查修复（mock 路径写错、并发测试自证式、丢失 checkSlotAvailable 依赖注释）+ 最终整体分支审查（Ready to merge: Yes），文档已回填与实际落地对齐

## 未完成 / 范围外
- worker claim 任务后若进程崩溃/被杀，`status='running'` 会永久卡死，无超时回收机制（旧两步式实现同样没有，本次未修，但即将部署到 mmv 常驻多实例会放大这个问题）
- 未接真实 Postgres 跑并发冒烟，`FOR UPDATE SKIP LOCKED` 的真实互斥语义只经过 mock 单测验证，未经真库集成测试

## 下一步

**已注册 Brain 任务**：`task_id = a844a24b-f25f-420a-9913-21f5e5c89e5f`（`task_type=dev`，priority=P2）。下个 session 直接 `/dev --task-id a844a24b-f25f-420a-9913-21f5e5c89e5f` 接手，或至少先 `curl localhost:5221/api/brain/tasks/a844a24b-f25f-420a-9913-21f5e5c89e5f` 读一遍描述。

### 已勘查到的事实（省得下个 session 重新翻）
- **"mmv" 就是本机**（`~/.ssh/config` Host mmv → 38.23.47.81，即当前跑 Claude/Brain 的这台美国 Mac mini）。部署 worker **不需要 SSH 到别的机器**，直接在本机操作即可。
- **进程常驻用 pm2，本机已装且在用**（`pm2 list` 里已有 `gemini-relay`/`douyin-proxy` 两个 fork 模式的 Node 服务作为先例）。`skill-eval-worker.js` 的 `runOnce()` 跑一次就退出，不能直接 `pm2 start`——要么包一层 `while true; do node skill-eval-worker.js; sleep 5; done` 的 wrapper 脚本再让 pm2 管这个 wrapper，要么用 pm2 的 `cron_restart`（跑完自然退出，pm2 按 cron 表达式重新拉起）。两种都可以，选哪个是下个 session 自己判断的实现细节。
- **API 路由已存在**：`packages/brain/src/routes/eval.js`——`POST /api/skill-eval`（上传入口，第80行）、`GET /api/skill-eval/status/:task_id`、`GET /api/skill-eval/report/:task_id`、`POST /api/skill-eval/complete`（第298行，worker 回调用，带 `X-Eval-Proxy-Token` 校验）。这些路由已经挂在 Brain（localhost:5221）上，"HK /eval-api 反代"要做的是把这套已存在的 API 从 HK VPS 暴露到公网，不是重新写 API。
- **worker 需要的环境变量**（见 `skill-eval-worker.js` 顶部）：`CLAUDE_BIN`（默认 `/opt/homebrew/bin/claude`）、`CLAUDE_CONFIG_DIR`（默认 `~/.claude-account2`）、`EVAL_PROMPT_PATH`（默认指向 `~/perfect21/skill-eval-formb-assets/eval-prompt.txt`，需确认该路径在部署环境下依然有效）、`EVAL_PROXY_TOKEN`、`BRAIN_BASE_URL`（默认 `http://localhost:5221`）。
- **HK VPS 只能走 Tailscale**：`ssh root@100.86.118.99`（公网 22 不通，见 memory `infrastructure.md`）。反代配置具体走 HK 现有 nginx 还是新开端口/新 server block，需要先 SSH 上去看一眼现状再定，本次未勘查。

### 执行清单
1. **补 running 超时回收器**（建议先做，否则常驻多实例会把"取了丢"的问题放大）：在 `skill_evals` 表加一个基于 `updated_at` 的超时判断，`status='running'` 且 `updated_at` 早于 N 分钟 → 重置回 `pending`（或标 `failed`）。可以做成 worker 每次 `runOnce()` 之前先跑一次清扫，也可以做成独立的定时任务。
2. **mmv 常驻部署**：选 wrapper loop 或 `cron_restart` 其中一种方式，用 pm2 管起来，确认崩溃后能自动拉起。
3. **HK /eval-api 反代**：SSH 上 HK VPS 先看现有 nginx/proxy 配置，决定新增 location 还是新 server block，把 `/eval-api/*` 转发到 mmv 的 Brain（`http://38.23.47.81:5221/api/skill-eval/*`，注意鉴权 token 别走漏）。
4. **端到端验证**：真实上传一个 skill zip（可以直接拿之前 Track 2 sprint 用过的示例包）→ 走完整链路（上传→worker 认领→跑 claude 评估→回调 complete→能查到 report）→ 确认 `GET /api/skill-eval/report/:task_id` 返回正常渲染的报告。
5. **补真库并发冒烟**（Minor，非阻塞）：对真实 Postgres 插两条 pending fixture，并发调用两次 `claimPendingTask()`，确认真的互斥（当前只有 mock 单测覆盖）。

## 数据源
- 设计文档：docs/superpowers/specs/2026-07-08-skill-eval-worker-atomic-claim-design.md
- 实施计划：docs/superpowers/plans/2026-07-08-skill-eval-worker-atomic-claim.md
- 前置 handoff：docs/handoffs/202607082138-skilleval-formb-track2.md（PR #3640）

## 决策引用
- decisions: skill-eval-worker 取任务原子化（category=small-change，2026-07-08）

## 异常记录
本次执行中原 session worktree（`/Users/administrator/worktrees/cecelia/session-a7e5625f`）在等待 push 完成期间被意外删除（非本次操作触发），已通过 `git worktree add` 从主仓库保留的分支对象重新恢复出临时 worktree `cp-07082150-recovery` 完成收尾，未丢失任何 commit。根因未查（疑似某个并发的 session 生命周期清理机制误删活跃 worktree），值得后续排查，暂未建 notion-issue。
