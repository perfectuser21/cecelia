# Learning: fidelity-gate 失守 — 功能没建也 merge（Final E2E 假 PASS）

> 分支：cp-0603170434-harness-artifact-gate
> 日期：2026-06-03

## 现象

harness run 926779b5 请求 `GET /api/brain/harness/healthz` 端点。generator **只写了 Red 测试**
（`sprints/open2-verify.../tests/harness-healthz.test.js`），**没实现路由**（`harness.js` 无 /healthz）。
但 Final E2E 报 `PASS`、PR #3276 被 merge。本该拦住"功能没建"的门禁全部失守。

## 根本原因（三层全漏）

**层1 — CI path-filter**：`changes` job 判 `brain= grep '^packages/brain/'`。PR 只动了 `sprints/**`
（test+合同），diff 无 `packages/brain/` → `brain=false` → `brain-unit`/`harness-dod-integrity`/
`brain-integration` 全 skip，`brain-unit-all` 3 秒空过。那条在 sprints/（brain vitest include 内）
的 Red 测试根本没在 CI 跑。

**层2 — Final E2E（reportNode 纯推导）**：`harness-initiative.graph.js:981`
`final_e2e_verdict = sub_tasks.every(status==='merged') ? 'PASS':'FAIL'`。reportNode 不执行合同
oracle，只看"全 merged 就 PASS"，把信任全押在 pre-merge evaluator 上。

**层3 — pre-merge evaluator（核心）**：`evaluateContractNode` spawn LLM `harness-evaluator`。
local_api 模式它 curl **活的宿主 brain**（`host.docker.internal:5221`，跑 main、且重部署中常不可达）
→ **结构上验不了 PR 分支的新路由**（实现对了也 404，没建也 404）；verdict 由 LLM 写文件，这条 run
`evaluate_verdict="PASS"`，说明 LLM 把 curl 失败/brain 不可达 hand-wave 成 PASS。**关键缺口**：合同
里有确定性 ARTIFACT 检查（`node -e "harness.js...includes('/healthz')"`，不依赖活 brain/LLM），但
brain 侧从没真跑过这些 ARTIFACT 命令。

## 修法

**主修（治本）— evaluateContractNode 加确定性 brain 侧 ARTIFACT 门**：LLM evaluator 之前，brain 自己
checkout PR 分支到隔离 worktree + 跑 contract-dod.md 的 `[ARTIFACT]` Test 命令（`extractArtifactTests`
/`runArtifactGate`/`verifyContractArtifactsForPr`）。任一确定性失败 → 强制 `verdict=FAIL`，无视 LLM、
不依赖活 brain。**fail-open**：门跑不起来（无合同/无 worktree/无 ARTIFACT 条目/fetch 失败）→ ran=false，
放过给 LLM，不误杀；只有命令"确定性地失败"才强制 FAIL。

**次修（defense-in-depth）— CI path-filter**：`sprints/**/*.{test,spec}.*` 改动也触发 `brain=true`，
让在 sprints/ 的 Red 测试在 CI 真跑并 FAIL。

## 下次预防

- 验证层禁止"信任传递"代替"亲自验证"：reportNode 的"全 merged = PASS"是把验证外包给 LLM evaluator，
  应有确定性 brain 侧 oracle 兜底。
- LLM 当 QA 默认会 over-pass（Anthropic 官方原话），任何"LLM 给 verdict"必须有确定性门兜底。
- local_api 的 BEHAVIOR curl 打活 brain（跑 main）结构上验不了 pre-merge PR 的新路由——这类 oracle
  要么 PR-分支域起 ephemeral server，要么换确定性 ARTIFACT 检查。本 PR 先上 ARTIFACT 门。
- CI path-filter 按目录前缀判"哪个组件改了"时，要考虑该组件的测试 include 是否覆盖其它目录（sprints/）。

## 验证 checklist

- [x] failing test 先行（commit-1 Red：extract/runGate/verify/evaluateContractNode 强制 FAIL + CI path-filter）
- [x] 实现让 test 变绿（commit-2 Green），16/16 通过
- [x] 回归不破（harness-task-verdict / harness-initiative-evaluate / container-liveness / spawn-base-repo 48 绿）
- [x] DevGate facts-check 通过；ci.yml YAML 合法
- [ ] CI 全绿合并 + 部署 + 闭环 run 验证（实现真做→PASS / 只写测试→ARTIFACT 门强制 FAIL）
