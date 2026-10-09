# Handoff — 2026-09-12 · us-vps HOME 环境变量误配修复（github_token_unavailable）

task_id: unknown（本次未预注册 Brain task，直接走 systematic-debugging → engine-worktree 修复路径）
verdict: PASS

## 一句话

昨晚 handoff 遗留的"task feef7d3f 卡死之谜"真根因已找到并修复验证：`packages/brain/Dockerfile` 烙入 `ENV HOME=/Users/administrator`（macOS 专属），`docker-compose.us-vps.yml` 漏了对 `HOME` 本身的 override，导致 Linux 生产容器内 `os.homedir()` 解析成不存在的路径，`harness-credentials.js` 因此永远读不到 `/root/.credentials/github.env`，抛 `github_token_unavailable`。

## 完成了什么（done）

- 用 systematic-debugging 完整走完 Phase1-3：live `docker exec` 复现（不带 HOME override 必现 `github_token_unavailable`，加 `HOME=/root` 立即 `SUCCESS`），找到 `docker-executor.js` 已有的 `HOST_HOME` 优先模式作为参照
- PR #5287（已合并）：`docker-compose.us-vps.yml` 的 `environment:` 段新增 `HOME=/root`，TDD 先立失败断言（`factory-f2-deploy-smoke.sh` 新增一条 `HOME=/root` 结构断言，先红后绿，24/24）
- 生产已应用：`git pull` + `docker compose -f docker-compose.us-vps.yml up -d node-brain` 重建容器（无需重建镜像，纯 compose 层修复）；容器健康检查通过；`docker exec` 直接验证 `process.env.HOME=/root` 且 `resolveGitHubToken()` 返回 `SUCCESS`
- 写入 decision `e5741ccc`（根因说明）+ 新建 issue `2fcd657c`（记录后续发现的独立问题，见下）

## 没做的 / 明确排除（not_done）

- **新发现的独立问题**：修完凭据 bug 后，把 task `feef7d3f` 重新 block→unblock 打回 `queued`，观察 2.5 分钟（tick loop 确认 healthy 在跑），task 的 status/execution_attempts/claimed_by/updated_at 全部纹丝不动——说明 tick 的自动 dispatch 压根没有尝试碰这个 task，跟 HOME/凭据 bug 完全独立。已建 issue `2fcd657c`（比旧 issue `dea5237b` 的时区偏移猜测更准确——那个猜测已被本次证伪：凭据修完后 task 依然不动，说明卡住原因不是凭据/时区，是 dispatcher/tick 候选任务筛选逻辑本身）
- 不改 `packages/brain/Dockerfile`（会影响 macOS 镜像行为）
- 不改 `harness-credentials.js` 代码逻辑（函数本身正确，问题在环境变量）
- 不批量审计/修改其余 ~18 个直接调用 `os.homedir()` 的文件（更大范围的后续工作，本次只修最直接触发生产故障的这一处配置）

## 下一步（next_steps）

1. 调查新 issue `2fcd657c`：直接读 Brain 进程实时日志（不是查 DB 字段），在下一次 tick interval 窗口内观察 task `feef7d3f` 有没有出现在候选集合的日志行里——判断是 SELECT 筛选条件排除了它，还是选中后又被拒绝
2. 如果确认是筛选逻辑问题，需要单独走一轮 systematic-debugging（本次范围外）
3. 待 issue `2fcd657c` 解决后，task `feef7d3f`（本身是"生成 Linux 部署闭环 GP 提案"的任务）才能真正跑完，届时可以关闭 golden_path `199ae170` 的最后一个悬空环节

## 数据源（data_sources）

- decision `e5741ccc`（HOME 误配根因说明）
- issue `2fcd657c`（tick 从不派发 task 的独立新发现）
- 旧 issue `dea5237b`（已被本次证伪，仅供参考）
- `docs/handoffs/202609112311-brain-uslinux-final-handoff.md`（昨晚完整时间线）
- us-vps 现状：`cecelia-node-brain` 容器已应用 `HOME=/root`，代码在 `b33ce83`（main HEAD）

## 产物（artifacts）

- PR: #5287（perfectuser21/cecelia，已合并）
- 分支：`cp-0912093302-fix-home-env-usvps-github-token`
