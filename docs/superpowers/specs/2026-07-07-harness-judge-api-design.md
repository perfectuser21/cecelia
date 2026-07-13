# 设计：harness 跨 repo 刀2 — judge API 化 + relay-runs 前台建档端点

日期：2026-07-07 ｜ 任务：cf74ba7d ｜ Issue：98e5dff4（跨 repo）/ 968b6f58（前台协议）｜ Journey：Cecelia Harness Pipeline（bb8cc561）

## 背景与目标

harness-controller Step 5 以仓库相对路径调 `node scripts/harness-judge-cli.mjs`——该工具只在 cecelia 仓且硬 import `packages/brain/src/harness-judge.js` 包树，base_repo=第三方 repo 时容器 /workspace 里不存在，judge 环整段断（跨 repo 头号硬阻断）。同时人工前台点火没有 initiative_runs 行，进度上报全 404。

目标：controller 对 judge 的调用降为一条 curl（与其它棒的 `$BRAIN_URL` 模式一致）；前台点火可建档。**runJudgeGate 逻辑零改动。**

## 方案选型

- A（选定）：Brain API 化。judge 逻辑本来就住在 packages/brain，Brain 容器有全部依赖 + TOAPIS 凭据挂载 + 宿主同路径可见 worktree（relay worktree 物理落点固定在 cecelia/.claude/worktrees/harness-v2/，harness-worktree.js DEFAULT_BASE_REPO）。调用方只需 curl。
- B（否）：judge-cli 随 skill 分发。需要把 packages/brain 依赖树带进每个目标 repo 容器，违背"工具链与被开发 repo 解耦"的方向。
- C（否）：把 cecelia 仓 mount 进 relay 容器。扩大攻击面且 node_modules 跨容器不可靠。

## 组件 1：POST /api/brain/harness/judge

新文件 `packages/brain/src/routes/harness-judge.js`（Router 导出，server.js `app.use('/api/brain/harness', ...)` 挂载；若该前缀已有 router 则并入既有文件，以 plan 阶段核实为准）。

请求体（对齐 CLI 参数）：
```json
{"task_id": "...", "sprint_dir": "...", "worktree": "/abs/path",
 "agent_verdict": "PASS|FAIL|FIXED（可选）", "agent_feedback": "（可选）",
 "prompt_dir": "（可选）", "transcript_file": "（可选）"}
```

行为（镜像 harness-judge-cli.mjs main()，语义一字不差）：
1. `task_id`/`sprint_dir`/`worktree` 缺一 → 400；`worktree` 非绝对路径或目录不存在 → 400
2. `agent_verdict` 显式优先，缺省读 `<worktree>/.brain-result.json` 的 `.verdict`/`.feedback`；两者皆无 → 400（对应 CLI exit 1）
3. `FIXED` 归一 `PASS`（前科语义）
4. `transcript_file` 给了就读，读失败不阻塞
5. 组装 ctx（`instanceLabel = judge-api-<taskId前8>`）调 `runJudgeGate`，返回 200 `{verdict, feedback, judged, judgeError?}`——HTTP 恒 200，裁决语义在 body（调用方以 verdict 分支，等价 CLI exit 0/2）
6. 执行异常 → 500 `{error}`（不泄内部 message，同 relay-runs PATCH 规矩）

环境事实（已核实）：runJudgeGate 纯函数注入形态、无 DB 依赖；TOAPIS key 走 env 或 `~/.credentials/toapis.env`（容器 read-only mount 已有）；key 缺失/DeepSeek 失败默认 fail-open 保留 agent verdict（`JUDGE_STRICT=1` 才 fail-closed）——与 CLI 行为完全一致，API 化不改变任何裁决语义。

## 组件 2：POST /api/brain/orchestrator/relay-runs/:initiative_id（前台建档）

加在 `routes/initiatives.js`（已挂 /api/brain/orchestrator 前缀）。

1. 查 tasks：initiative_id 无对应行或 task_type ≠ harness_initiative → 404
2. 幂等：已存在 `orchestrator_version='v2'` 且 phase 非终态的行 → 200 返回现有行 `{created:false}`
3. 否则 INSERT（列对齐 harness-skill-relay.js:239 既有 INSERT）：
   `(initiative_id, phase='planning', journey_id=task.payload.journey_id||body.journey_id||null, orchestrator_version='v2', orchestrator_host='foreground', deadline_at=NOW()+INTERVAL '6 hours')` → 201 `{created:true, run}`
4. body 可选 `{phase}` 仅接受 312 CHECK 白名单值，非法 → 400

## 组件 3：relay-watchdog 跳过 foreground（防无头双跑，本设计新识别的坑）

`harness-relay-watchdog.js` resumeStalledRelayRuns 循环内加一条护栏：`run.orchestrator_host === 'foreground'` → continue。
理由：前台 run 没有 `cecelia-relay-*` 容器，watchdog 的"容器消失=死跑"判据对它恒真，会 spawn 无头容器与前台会话双跑。前台崩溃恢复靠人（用户在场是前台模式的定义），不靠 watchdog。house-keeping 分支（task 终态收敛 run 行）保留对 foreground 生效——这是对的。

## 组件 4：快照刷新

`scripts/sync-skills-snapshot.sh` SKILLS 数组补 `harness-controller`；以 `SKILLS_SSOT_DIR=/Users/administrator/perfect21/zenithjoy-skills-dist`（= origin/main 内容）跑一遍，刷新的 SKILL.md 快照随本 PR 入库（loadSkillContent CI fallback 当前 evaluator 停在 1.16.0）。

## 不做（后续刀）

- controller skill Step 5 从 node CLI 切到 curl 本端点 → zenithjoy-skills 侧 PR（刀3 配套）
- staging unknown 线部署策略（刀3）、LangGraph 死代码删除（刀4）
- harness-judge-cli.mjs 保留不删（本机兼容）

## 测试策略

档位：integration（路由层）+ unit（护栏）+ 部署冒烟。无 UI 无真机，不需要 E2E。

1. **judge 路由**（vitest + supertest + vi.hoisted mockPool 模式，参照 `src/__tests__/relay-runs.test.js`；runJudgeGate 以依赖注入 mock）：缺必填 400 / worktree 不存在 400 / FIXED 归一后以 PASS 进 runJudgeGate / .brain-result.json 回退读取 / 两者皆无 400 / runJudgeGate 结果透传 / 抛错 500
2. **relay-runs POST**：task 不存在 404 / 非 harness_initiative 404 / 首建 201 列值正确（host=foreground）/ 重复调用 200 created:false 不多建行 / 非法 phase 400
3. **watchdog 护栏**（现有 watchdog 单测模式扩展）：host=foreground 的 run 不触发 spawnFn
4. **冒烟** `packages/brain/scripts/smoke/judge-api-smoke.sh`：真启动后两端点空 body 应答 400（而非 404）——proven-to-fire：先故意打错路由名看它红一次
