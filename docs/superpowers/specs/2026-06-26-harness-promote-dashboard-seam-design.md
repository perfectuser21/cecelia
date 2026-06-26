# harness 内部线 staging→promote 接缝对齐 dashboard（A 方案）设计

**Goal:** 让 harness 内部线（base_repo=cecelia）pipeline 能端到端走完 staging→production——staging 步构建并验证 dashboard，promote 步把验证过的 dashboard 发布到生产 5211。

**Architecture:** 内部线 staging 步从"部署 brain 到 :5222"改成"用 deploy-local.sh 构建 dashboard 到 staging 5223 + 写 .staging-pending"；staging E2E 改验 dashboard 5223；promote 步修两个 bug 后跑 promote-dashboard.sh（此时 .staging-pending 已由 staging 步产生）。

**Tech Stack:** Node ESM（packages/brain/src），bash 部署脚本，vitest 单测。

---

## 背景：当前接缝是断的（三层根因，已诊断）

1. **路径 bug**：`staging-e2e-runner.js:206/212` promote 用裸 `getRepoRoot()`（容器内=`/`）→ 找不到脚本。
2. **自杀 bug**：`staging-promote.js` `defaultPromoteExec` 没设 `CECELIA_SKIP_BRAIN_PROMOTE=1` → promote-dashboard.sh 跑 brain-deploy 重启执行它自己的 Brain。
3. **架构错配（根本）**：staging 步验 brain（:5222 via staging-deploy.sh），promote 步调 dashboard 的 promote-dashboard.sh（硬依赖 `.staging-pending`，无则 exit 1），而 harness 流程从不产生 `.staging-pending` → promote 必败。

主理人决策（2026-06-26）：**A = 内部线交付物 = dashboard**。先做 A 让 harness 今天能端到端跑通一次；B（brain）/C（智能判断）后续。

---

## 设计：三处改动

### 改动 1：deployStaging 内部线走 deploy-local.sh（构建 dashboard + 写 .staging-pending）
- `deployStaging(opts)` 新增按线路分流：`opts.line==='internal'` → 跑 `scripts/deploy-local.sh --changed="apps/dashboard/"`（强制走 dashboard build 分支，不依赖 git diff——harness 合 main 后在 main 上跑 diff 为空）；否则保持 `staging-deploy.sh`（brain :5222，给 B/未来）。
- `deploy-local.sh` 非阻塞：构建 dashboard 到 `.dist-staging` + 起后台常驻 staging slot（5223）+ 写 `apps/dashboard/.staging-pending`，然后脚本返回（已验证不停住等人）。
- repoRoot 一律 `process.env.REPO_ROOT || getRepoRoot()`（容器内 REPO_ROOT=bind-mount repo 根，脚本存在）。
- deployStaging 返回新增 `stagingPort`（内部线=5223 / brain=5222），供 staging E2E 用。

### 改动 2：staging E2E 验 dashboard 5223（thin，walking skeleton）
- `runScenarios`/`runStagingCommand` 用 deployStaging 返回的 `stagingPort`，把 contract scenario 命令里的目标端口重写到 5223（内部线）。
- thin 验证：scenario 用 `curl http://host.docker.internal:5223/` 断言 HTTP 200 + 首页含本次 run 的可见标记（合同里定义）。
- 加厚（不在本次）：Playwright（target=mac_web）做真 UI 行为验证。

### 改动 3：promote 修两个 bug（让 promote 真能跑通换 5211）
- `staging-e2e-runner.js:206` `defaultPromoteExec(process.env.REPO_ROOT || getRepoRoot())`；`:212` `readProductionInfo(process.env.REPO_ROOT || getRepoRoot())`。
- `staging-promote.js` `defaultPromoteExec`：`execSync('bash '+script, { cwd, encoding, timeout, env:{...process.env, CECELIA_SKIP_BRAIN_PROMOTE:'1'} })`。
- promote-dashboard.sh 此时有 `.staging-pending`（改动 1 产生）→ 原子换入 5211 + 打 tag + 留存 + 写 .production-release。

---

## 数据流（端到端）

点火（改 dashboard 的内部线 run）→ planner → contract → generator 写 dashboard 代码 → PR → CI 绿 → 合 main → **staging 步：deploy-local 构建 dashboard + 起 5223 + 写 .staging-pending** → **staging E2E：scenario 打 5223 验证** → PASS → **promote：promote-dashboard.sh（SKIP_BRAIN_PROMOTE=1）换 5211** → auto_promoted → report（成功交付证书）。

## 错误处理
- deploy-local 失败 → status=failed reason=deploy_failed，不 promote。
- staging E2E FAIL → verdict=FAIL，不 promote，report failure。
- promote 失败（.staging-pending 缺失/换入失败）→ promote_failed，report failure。
- 全部 best-effort 不阻断 verdict 落库（沿用现状）。

## 测试策略
- **单元（vitest，packages/brain/src/__tests__）**：
  - `deployStaging` 注入 mock exec：内部线断言调 `deploy-local.sh` + `--changed=apps/dashboard` + repoRoot=REPO_ROOT；非内部线仍调 staging-deploy.sh。
  - `handlePromote` 注入 mock：设 `process.env.REPO_ROOT` 后断言 `defaultPromoteExec` 收到的 repoRoot 来自它。
  - `defaultPromoteExec` 注入 mock execSync：断言 env 含 `CECELIA_SKIP_BRAIN_PROMOTE=1`。
  - staging E2E 端口重写：断言内部线用 5223。
  - 均为 RED-first（先写失败测试再改实现）。
- **集成（真跑，不在 CI）**：点火一条真 harness 内部线 dashboard run，端到端验证走到 auto_promoted + 5211 生效（spec 之外的验收动作）。

## 不包含
- B（brain 交付）/ C（智能判断）。
- Playwright 深度 UI 验证（thin 先用 curl）。
- promote 的 langgraph interrupt/resume 收编（Phase 3）。
