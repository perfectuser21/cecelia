# Sprint PRD — codex relay 有头 tmux 派发最小验证片：mode=headed 分支 + ssh/tmux spawn + 完成检测/收窗 + dry-run 验收（不改默认，不建池，不做三段式）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（82%）
- **当前进度**：82%
- **本次推进预期**：向 codex 有头派发生产可用推进 1 格（验证门槛 cf998025）

## 背景

decision cf998025（2026-07-06）：有头为默认派发模式已拍板，切默认前须先通过本 sprint 验证 headed spawn 不干扰现有合同纪律。codex 无头 docker relay 已跑通（PR #3597），本片仅加 mode=headed 分支，不改任何现有路径。

## Golden Path（核心场景）

用户 POST `mode:headed` 任务 → Brain tick ssh 逃逸宿主起 tmux session 跑 codex TUI → 用户 tmux attach 围观 → codex 完成后自回写 → watchdog 检测收窗。

具体：
1. 用户 POST tasks（executor=codex, mode=headed）→ Brain 校验 mode 白名单（缺省/headless/headed）；claude+headed → 400 拒绝
2. tick spawnSkillRelaySession → headed 分支：ssh 到宿主，把 prompt 写入 `/tmp/cecelia-host-prompts/<taskid>.<instance>.prompt`（0600），**禁止 `$(cat)` 内联进 tmux 命令串**
3. `tmux new-session -d -s codex-relay-<short>` 在宿主 worktree 路径启动 codex TUI；env=`CODEX_HOME=$HOME/.codex-team2`；**不注入 GITHUB_TOKEN**（宿主 gh 既有凭据）
4. `tmux pipe-pane -o` 留痕到 `<sprint_dir>/tui.log`，管道洗敏（`gh[ps]_/github_pat_` 正则）；initiative_runs 落行 orchestrator_host=`skill-relay-codex-headed`
5. 用户 `tmux attach -t codex-relay-<short>` 围观（独立 session，禁寄生用户 slot1-7）
6. codex 完成 → session 内按 prompt 硬指令自回写（PATCH relay-runs done + tasks completed）
7. watchdog headed 分支：`ssh 宿主 tmux has-session` 检测存活；**ssh 本身失败 → fail-open 跳过（不重点火）**；session 消失且 run 未 done 且 PR 未 MERGED → 走现有重点火链
8. 收窗：run 终态（done/failed）保留 30min 后 kill-session；**必须幂等**（已收过不再重复 kill）

## 边界情况

- ssh 逃逸失败 → B4 spawn 失败回滚（ALERT + 回 queued 清 claim）
- claude+headed → 400
- watchdog ssh 命令失败 → fail-open，不计为存活失败
- 收窗幂等：tmux_killed_at 或等价机制由合同阶段钉死

## 范围限定

**在范围内**：mode=headed 新分支（ssh+tmux spawn）、prompt 文件交付、tui.log 留痕洗敏、watchdog headed 存活检测（fail-open）、收窗幂等、单测 5 项、dry-run 真验证、收窗真验证
**不在范围内**：不改 codex 缺省模式；不建账号池；不做 orchestrator_host 三段式与 LIKE 重构；不动 claude relay；不接西安机器；deadline/attempts 独立值待后续讨论

## 假设

- [ASSUMPTION: codex CLI prompt 文件交付最稳形态（tmux send-keys 分块 vs prompt-file 参数）由 proposer GAN 阶段实测 codex 0.142 TUI 后钉死，PRD 锁"prompt 完整送达"行为不锁实现方式]
- [ASSUMPTION: 宿主 tmux / codex 0.142+ / ssh 链路均已生产验证可用，proposer 不需额外 bootstrap]

## 预期受影响文件

- `packages/brain/src/skill-relay.js`（或 spawnSkillRelaySession 所在模块）：加 mode=headed 分支逻辑
- `packages/brain/src/watchdog.js`（或 relay watchdog 所在模块）：加 headed tmux 存活检测 + fail-open + 收窗幂等
- `packages/brain/src/routes/tasks.js`（或 POST tasks 入口）：mode 白名单校验 + claude+headed→400
- `packages/brain/tests/`：新增 *.test.js 含 5 项单测

## E2E 验收

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1. dry-run：POST mode=headed 任务 → ssh 宿主 tmux has-session -t codex-relay-<short> exit 0
#             prompt 文件在宿主存在且 sha256 完整 → initiative_runs.orchestrator_host='skill-relay-codex-headed'
# 2. 收窗真验证：PATCH run=done → watchdog → tmux has-session exit 1 → 第二轮 watchdog 不再产生 kill（日志断言）
# 3. 单测覆盖：①headed→ssh+tmux路径（无docker extraMounts）②缺省/headless→docker零回归 ③claude+headed→400
#             ④watchdog ssh失败→fail-open ⑤收窗幂等
```

## NFR 约束

<!-- 来源: PrepPRD 显式值优先，decisions 副源补充 -->
- 超时/延迟: deadline=8h / attempts=2（沿用现有值，有头场景独立值待 Sprint 2 前决策）
- 频控: 并发守门 MAX=1（headed run 计入同一 MAX，守门 SQL 显式加 headed 取值）
- 可观测: tui.log 留痕（管道洗敏 `gh[ps]_/github_pat_` 正则）；ssh 失败必须写 Brain log；spawn 失败走 ALERT

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级三源合并去重 -->
- [单 slot 串行] 单 slot 内严格串行执行任务，前一个收口才起下一个（来源: area）
- [禁写死环境假设] 环境假设值（坐标/阈值/env变量）禁止写死，要么从环境推导要么真机校准（来源: area）
- [真环境验证才 done] 接缝断言必须在真目标上验证过才标 done（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] PII/客户隐私不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth（来源: area）
- [租户隔离] 租户数据查询/写入必须 scope 到当前租户（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey bb8cc561 golden-paths 查询，返回空（本 journey 暂无已完成 ability golden-path 记录） -->
（本 line 暂无历史 golden-path 累积 FR — skill-relay one-session 与 codex 无头 docker relay 已生产在跑，golden_path 表暂未落行）

---

journey_type: autonomous
journey_type_reason: 本 sprint 仅改 packages/brain/src/ 后端 headed spawn 逻辑，无 UI / agent 协议 / engine 变更
target_environment: local_api
target_environment_reason: 纯 Brain 后端改动，E2E 用 curl localhost:5221 + psql + ssh 宿主 tmux 命令验证
journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
step_id: ce82cffa-3b04-4f9f-b048-1413403e59e1
