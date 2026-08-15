# Sprint PRD — harness-control-plane-complete-repair-smoke.sh 报告真实 /api/brain/version

## OKR 对齐

- **对应 KR**：KR-Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除冒烟脚本假成功隐患，Kernel Harness 全链自证）

## 背景

`packages/brain/scripts/smoke/harness-control-plane-complete-repair-smoke.sh` 会先请求
`GET /api/brain/version` 校验版本地板与 schema >= 430，再查 authority-table，最后打印
`PASS: Brain 1.273.46 schema 430 ...`。该 PASS 消息里的版本号是**硬编码字面**，与运行时
真实版本脱钩（点火时刻 `/api/brain/version` 实测返回 `1.273.53`，脚本仍打印 `1.273.46`）。
硬编码 PASS 文本会让冒烟\"看起来通过\"却报告过期版本，掩盖真实部署状态——这是典型假成功。

## Golden Path（核心场景）

系统/运维执行 harness-control-plane-complete-repair-smoke.sh → 校验通过 → PASS 消息报告
`/api/brain/version` 实时返回的真实版本。

具体：
1. [触发条件] 运维/CI 在部署后运行 `bash packages/brain/scripts/smoke/harness-control-plane-complete-repair-smoke.sh`
2. [系统处理] 脚本请求 `GET /api/brain/version`，fail-closed 校验版本 >= 地板 且 `schema_version >= 430`，再 fail-closed 校验 authority-table（4 张控制面权威表/列存在）
3. [可观测结果] 最终 PASS 消息含 `/api/brain/version` 返回的**真实 version 字面**（当前为 `1.273.53`），而非硬编码 `1.273.46`

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导；/api/brain/version 返回 {version, schema_version} -->

## 边界情况

- `/api/brain/version` 返回的版本高于硬编码地板（如 1.273.53 > 1.273.46）：PASS 必须报告真实值，不得回退到地板字面
- schema_version < 430：脚本必须 fail-closed 非零退出，不得打印 PASS
- authority-table 任一表/列缺失：脚本必须 fail-closed 非零退出
- 回归测试必须对\"硬编码任意版本字面\"转红（即使该字面恰好等于当前运行时版本，也应因\"来自硬编码而非 API\"而失败）

## 范围限定

**在范围内**：
- 仅改 `harness-control-plane-complete-repair-smoke.sh` 的最终 PASS 版本上报逻辑（改为读取 `/api/brain/version` 的真实 version 变量后打印）
- 新增一条**永久回归测试**：硬编码版本 PASS 文本转红，运行时 API 版本被真实上报时转绿
- 保留 schema >= 430 的 fail-closed 校验与 authority-table 的 fail-closed 校验（逻辑不动）

**不在范围内**：
- 不改 `/api/brain/version` 端点实现
- 不改版本地板数值或 schema 阈值
- 不改 authority-table 的 4 项检查内容
- 不动 Kernel Harness 其他环节代码（Planner→Judge 链路由 harness 编排，非本 sprint 代码改动）

## 假设

- [ASSUMPTION: `/api/brain/version` 返回 JSON 含 `version`（字符串，如 "1.273.53"）与 `schema_version`（如 "430"）— 点火实测已确认]
- [ASSUMPTION: 回归测试落位与其它 smoke 回归同层（`packages/brain/scripts/smoke/` 或对应 quality 回归目录），由 Proposer 依 CI 布局定]
- [ASSUMPTION: Unified Map — map_scope=["F1"]，map_repo 未提供，故 Unified Map 未完整配置，本 PRD 不据其做领域猜测]

## 预期受影响文件

- `packages/brain/scripts/smoke/harness-control-plane-complete-repair-smoke.sh`：最终 PASS 消息改为报告 `/api/brain/version` 真实 version（当前 line 44 硬编码 `Brain 1.273.46`）
- `packages/brain/scripts/smoke/`（或 quality 回归目录）新增永久回归测试：断言硬编码版本 PASS 转红、真实 API 版本被上报转绿

## NFR 约束

<!-- 来源: decisions 表 category=nfr（golden-path + feature 双源均为空），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定；沿用 curl 默认）
- 频控: 无
- 版本要求: schema_version >= 430（fail-closed 保留）；版本地板 >= 1.273.46（fail-closed 保留）
- 可观测: PASS/FAIL 必须真实反映 `/api/brain/version`；失败必须非零退出（fail-closed）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [防假成功] 冒烟 PASS 必须反映运行时真实状态，禁止硬编码字面制造\"看起来通过\"（来源: area / 本 sprint 核心铁律）
- [fail-closed] schema<430 或 authority-table 缺失时必须非零退出，不得打印 PASS（来源: area）
- [Kernel 时钟] Evaluator/Judge 校验时钟默认 fail-closed；缺失或与 GitHub 实时观测不一致一律拒绝（来源: area — Kernel existing PR evaluator validation clock）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path（journey_id 为空，无 line 历史） -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl + bash + 回归 test）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
#  1. RED — 把 PASS 消息还原成硬编码版本字面时，回归测试转红并指出\"版本来自硬编码而非 API\"
#  2. GREEN — PASS 消息报告 curl GET /api/brain/version 返回的真实 version（当前 1.273.53）时回归测试转绿
#  3. fail-closed 保留 — 构造 schema_version<430 或 authority-table 缺失场景，脚本非零退出、不打印 PASS
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 后端冒烟脚本与回归测试，无 UI/远端 agent/engine 路径
## target_environment: local_api
## target_environment_reason: 冒烟脚本走 curl localhost:5221/api/brain/version + psql authority-table，本地 evaluator 执行
## journey_id: none
## step_id: none（PrepPRD 未锚定）
