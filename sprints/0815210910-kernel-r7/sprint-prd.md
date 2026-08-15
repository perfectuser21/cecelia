# Sprint PRD — 修复 harness-control-plane-complete-repair-smoke.sh 的 PASS 版本上报（真实运行时版本，非硬编码）

## OKR 对齐

- **对应 KR**：KR2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环，当前 82%）
- **当前进度**：82%
- **本次推进预期**：+0.3%（消除控制面冒烟的假可信 PASS 文案）

## 背景

`packages/brain/scripts/smoke/harness-control-plane-complete-repair-smoke.sh` 在版本闸 + 权威表闸全部通过后，最后一行打印的是硬编码文案 `PASS: Brain 1.273.46 schema 430 ...`。运行时 `GET /api/brain/version` 现已返回 `1.273.54`，PASS 文案却仍报 `1.273.46` —— 冒烟输出与真实部署版本脱节，读日志的人会被误导为部署了旧版本。需让 PASS 文案上报 API 实际返回的版本，并加一条永久回归测试，防止硬编码版本再次回潮。

## Golden Path（核心场景）

运维/CI 在 Brain 部署后运行控制面修复冒烟 → 冒烟读取真实运行时版本并逐闸校验 → 最终 PASS 文案回显 API 实际返回的版本字符串。

具体：
1. 冒烟执行 `curl $BRAIN_URL/api/brain/version`，拿到运行时 `version` 与 `schema_version`。
2. 版本闸：`version` 低于下限或 `schema_version < 430` 时 fail-closed 退出（**保持不变**）。
3. 权威表闸：psql 校验 `harness_attempt_cleanup_outbox` / `planner_recovery_receipts` / `planner_recovery_consumptions` 表与 `initiative_runs.planner_recovery_receipt_id` 列存在，缺失即 fail-closed（**保持不变**）。
4. 最终 PASS 文案不再含硬编码版本字面量，而是回显步骤 1 取到的 `version`（如运行时为 `1.273.54` 则 PASS 行含 `1.273.54`，绝不含写死的 `1.273.46`）。

出口：PASS 行包含 `/api/brain/version` 当前返回的确切版本；永久回归测试证明「写死版本字面量」被拒、「运行时版本被上报」成立。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导。已知 GET /api/brain/version 返回 {version, schema_version}。 -->

## 边界情况

- `/api/brain/version` 返回的 `version` 与 smoke 内下限不同（高于下限）——PASS 必须报实际返回值，不报下限值。
- 版本闸/权威表闸失败时——不得走到 PASS 行，保持非零退出（fail-closed）。
- 回归测试须对「smoke 源码里再次出现硬编码版本字面量」这一情形转红。

## 范围限定

**在范围内**：仅改该 smoke 的最终 PASS 版本上报方式（改为回显 API 返回值）+ 新增永久回归测试。
**不在范围内**：版本下限 `1.273.46` 判定逻辑、schema ≥ 430 闸、权威表 SQL 闸的行为改动；其他 smoke 脚本。

## 假设

- [ASSUMPTION: 回归测试落位 `packages/brain/scripts/__tests__/`（与既有 `map-engine-smoke.test.mjs` 同层），读取 smoke 源码断言无硬编码版本、并以桩/实跑证明 PASS 回显运行时版本。最终位置由 Proposer 定。]
- [ASSUMPTION: `GET /api/brain/version` 契约 `{version, schema_version}` 稳定；PASS 文案使用其中 `version` 字段。]
- [ASSUMPTION: Unified Map 未配置——task.payload.map_scope=["F1"] 但 map_repo 缺失，按 skill 如实记录 not_configured，不做领域猜测。]

## 预期受影响文件

- `packages/brain/scripts/smoke/harness-control-plane-complete-repair-smoke.sh`：最后一行 PASS 改为回显 API 返回的 `version`。
- `packages/brain/scripts/__tests__/harness-control-plane-repair-version-report.test.mjs`（新增，名字待 Proposer 定）：永久回归测试，硬编码版本转红 + 证明运行时版本被上报。

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 Proposer 在 GAN 阶段按 target_environment=local_api 填 curl+node/psql。

```bash
# 占位：proposer 将填入真实脚本（local_api → curl localhost:5221/api/brain/version + 运行 smoke + 运行回归测试）
# 期望验收点（自然语言）：
#  RED — 令 smoke 最终 PASS 行为硬编码版本字面量时，回归测试失败（退出非零）。
#  GREEN — 运行 smoke，抓取其最终 PASS 行，断言其包含 curl /api/brain/version 返回的确切 version 字符串，且不含写死的 1.273.46。
#  保持 — 篡改版本/权威表使前置闸失败时，smoke 在 PASS 行之前即 fail-closed 退出（非零）。
```

## NFR 约束

<!-- 来源: decisions 表 category=nfr（双源均空）；PrepPRD 未显式给 NFR -->
- 超时/延迟: 待定（PrepPRD 未指定，decisions 双源为空）
- 频控: 待定
- 版本要求: schema_version ≥ 430（沿用 smoke 既有闸，非本 sprint 新增）
- 可观测: PASS 文案必须如实反映 `/api/brain/version` 返回的运行时版本

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature 均空；下列为 area 级 -->
- [Brain URL 权威] Fleet Generator/冒烟必须使用授权的 Brain URL 权威（来源: area）
- [评估时钟采纳] Kernel 既有 PR 的 evaluator 采纳既有 validation clock（来源: area）
- [验证命令实跑] 合同/冒烟里的验证命令必须实跑确认 exit code 语义，绿态误判需防（vitest 对 include 范围外路径绿态也退出）（来源: area）
- [证据一手] evaluator/judge 证据消费窗口有限，产物须把一手证据前置（来源: area）
- [口径先查] 指标退化先查口径三源失真（未接线恒空/守卫自噬/双重计数）再当真实退化处理（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path -->
- （本 line 暂无历史 —— task.payload.journey_id 为空，非路径 C 点火）

## journey_type: autonomous
## journey_type_reason: 仅改 packages/brain/ 下的 smoke 脚本与后端回归测试，无 UI/远端 agent/engine hooks，属纯后端自治。
## target_environment: local_api
## target_environment_reason: 验收 = 本地 curl localhost:5221/api/brain/version + 运行 smoke + node 回归测试，无浏览器/Windows/生产远端。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
