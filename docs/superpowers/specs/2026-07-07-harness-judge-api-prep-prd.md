# 小改动 PrepPRD：harness 跨 repo 修复刀2 — judge API 化 + 前台点火建档端点

## 改什么
1. **POST /api/brain/harness/judge**（新路由，挂 packages/brain/src/routes/）：
   thin wrapper 包 `runJudgeGate`（packages/brain/src/harness-judge.js，逻辑零改动）。
   入参对齐 harness-judge-cli.mjs：`{task_id, sprint_dir, worktree, agent_verdict?, agent_feedback?, prompt_dir?, transcript_file?}`；
   agent_verdict 缺省时从 `<worktree>/.brain-result.json` 读；FIXED 归一 PASS（前科语义）。
   返回 `{verdict, feedback, judged}`；HTTP 200 恒定（verdict 承载裁决），参数缺失 400。
2. **POST /api/brain/orchestrator/relay-runs/:initiative_id**（initiatives.js 补建档端点）：
   为人工前台接管的 controller 建 initiative_runs 行（orchestrator_version='v2'，orchestrator_host='foreground'，phase 默认 'planning'）。
   幂等：该 initiative 已有 v2 未终态行 → 200 返回现有行，不重复 INSERT。
   校验 initiative_id 对应 task 存在且 task_type=harness_initiative，否则 404。
3. **快照刷新**：`bash scripts/sync-skills-snapshot.sh`（SSOT 指向 origin/main 内容）+ SKILLS 数组补 `harness-controller`（loadSkillContent 的 CI fallback 目前缺它）。

## 为什么改
- judge 环是 harness 跨 repo 头号硬阻断（Notion Issue 98e5dff4）：controller 用相对路径调 `scripts/harness-judge-cli.mjs`，该工具只在 cecelia 仓且硬 import packages/brain 包树，base_repo=第三方时容器 /workspace 里不存在。API 化后 controller 只需 curl $BRAIN_URL——与其它棒的既有模式一致。
- 前台点火无 initiative_runs 行（Issue 968b6f58）：进度上报/PR 回写全 404，dashboard 进度条无数据源。
- 路径可见性依据：relay worktree 物理落点固定在 cecelia/.claude/worktrees/harness-v2/（harness-worktree.js DEFAULT_BASE_REPO），Brain 容器按宿主同路径挂载可读，API 化不存在路径翻译问题。

## 关联上下文
- Journey：Cecelia Harness Pipeline（bb8cc561-b3ee-4fec-b74d-2255694bd963）
- Issue：98e5dff4（跨 repo 架构缺陷）/ 968b6f58（协议错位，前台建档是其 Brain 侧半边）
- 历史决策 match：无冲突命中
- 后续刀：skill 侧 controller Step 5 从 node CLI 切到 curl 本端点（zenithjoy-skills 另一 PR）；CLI 保留兼容不删

## 影响范围
- 新增路由，不动 runJudgeGate 逻辑、不动既有 GET/PATCH relay-runs 语义
- harness-judge-cli.mjs 保留（本机跑仍可用）
- 快照刷新只影响 CI fallback 读取

## 验收标准
- [ ] 单测：judge 路由参数校验（缺 task_id/sprint_dir/worktree → 400）+ runJudgeGate 被正确调用（mock）+ FIXED 归一
- [ ] 单测：relay-runs POST 幂等（重复调用不多建行）+ 非 harness task 404
- [ ] 部署后冒烟：两端点 curl 非 404（brain-deploy 后验证）
- [ ] CI 全绿

## 哨兵
- 逻辑接缝：上述单测进 CI 永久跑
- 环境接缝（Brain 部署路径）：packages/brain/scripts/smoke/ 补 judge-api-smoke.sh（真启动后 curl 两端点，参数缺失应答 400 而非 404——proven-to-fire：改错路由名跑一次看它红）
