# Sprint PRD — evaluateContractNode 职责分离：代码执行 + LLM 裁读

## OKR 对齐

- **对应 KR**：Cecelia Harness Pipeline 评估准确性与成本优化
- **当前进度**：Contract Gate 四轮已落地（#3348/#3351/#3353/#3357/#3358）
- **本次推进预期**：evaluateContractNode 职责分离完成，裁读成本目标 < $2/轮

## 背景

Contract Gate 确定性预检已稳定。当前 LLM evaluator 仍亲手执行合同 E2E 脚本，存在"LLM 变通执行/假装跑过"固有风险且成本高。本 sprint 完成最后一步：命令执行归代码（结构化执行记录），语义裁读归 LLM（只读记录不跑命令）。

## Golden Path（核心场景）

合同进入 evaluate 阶段 → 系统代码执行 E2E 脚本 → LLM 读执行记录出 verdict → 结论落盘

具体步骤：

1. **入口**：合同通过 Contract Gate 预检（已有，不变）
2. **代码执行**：系统代码在 cecelia/runner 容器内（复用 `runScenarioCommand` / `execFile` 封装）逐段执行合同 E2E 脚本；采集逐命令 exit code / stdout / stderr（截断可控）/ 耗时 / 所用环境；落盘 `execution-record.json`（按 #3345 命名协议，放 sprint 目录下）
3. **LLM 裁读**：将执行记录 + 合同 + sprint-prd Golden Path 交给轻量 LLM；LLM 只读记录，产出：`verdict`（PASS/FAIL/FIXED）、`coverage`（JSON 对照表，每步 → 对应命令/断言 → 通过与否）、FAIL 时含 `failed_step` + `fix_direction`（引用执行记录原文行）
4. **Brain 校验覆盖表**：Brain 代码校验 coverage 对照表覆盖 Golden Path 每一步；缺步 → 整体 FAIL（不由 LLM 自判）
5. **结论落盘**：verdict + coverage 写入 `.brain-result.json`（EvaluatorOutputSchema 兼容 + 新增 coverage 字段）；执行记录与裁读输出均按运行实例落盘
6. **失败型验证**：失败型 fixture → 执行记录如实捕获非零 exit 与失败输出 → LLM 裁读 verdict=FAIL + 具体 failed_step 与修复方向（引用执行记录原文行）

## 边界情况

- 执行器异常/超时：记录错误条目，LLM 仍可对部分执行记录裁读
- coverage 覆盖校验：由 Brain 代码执行，非 LLM 自判，缺步即整体 FAIL
- 回退开关：env/payload 控制新旧路径，默认走新路径；旧路径逻辑保留

## 范围限定

**在范围内**：`evaluateContractNode` 执行流程拆分（代码执行段 + LLM 裁读段）；结构化 `execution-record.json` 产出；LLM 裁读 prompt（只读记录不执行命令）；Brain 代码校验 coverage 覆盖完整性；新旧路径回退开关；单测（schema / coverage 校验 / 节点流程 / 回退开关）；fixtures 进回归

**不在范围内**：Contract Gate 规则改动（已独立 PR 完成）；mac_web / windows_cloud 路由大改；裁读 LLM 模型选型

## 假设

- [ASSUMPTION: `runScenarioCommand` / `execFile` 封装可直接复用于代码执行段，不新增容器配置]
- [ASSUMPTION: #3345 命名协议已在 harness 产物中确立，execution-record.json 沿用同一目录规范]
- [ASSUMPTION: 裁读段 LLM 调用通过 resolveAccount 同现有 evaluator spawn 相同的账号链路]

## 预期受影响文件

- `packages/brain/src/workflows/harness-task.graph.js`：`evaluateContractNode` 主流程拆分
- `packages/brain/src/harness-shared.js`：新增 `ExecutionRecordSchema`、`coverage` 字段扩展至 `EvaluatorOutputSchema`
- `packages/brain/src/harness-final-e2e.js`（或新增 `harness-e2e-runner.js`）：代码执行段封装
- `packages/brain/src/workflows/__tests__/harness-task.graph.test.js`：新增分离路径单测 + fixtures

## E2E 验收

> Planner 初稿此区块可留空（只写期望验收点的自然语言描述）。最终可执行的 E2E 脚本由 proposer 在 GAN 阶段产出（按 target_environment=local_api，写进 contract-draft.md 的 `## E2E 验收` 区块）。合同提示：curl 断言写进同一 pipeline 或捕获后 5 条语句内对同名变量断言；确属误报用 `gate-allow: <rule-id> <理由>` 豁免留痕。

```bash
# 占位：proposer 将按 local_api 填入真实脚本（文件系统检查 + curl localhost:5221 + node 单测）
# 期望验收点（自然语言）：
# 1. 通过型 fixture 进入 evaluate → execution-record.json 落盘（含逐命令 exit code/stdout）
#    → LLM 裁读 verdict=PASS → coverage 对照表含 Golden Path 全部 6 步
# 2. 失败型 fixture → execution-record.json 含非零 exit → LLM 裁读 verdict=FAIL
#    + failed_step + fix_direction（引用执行记录原文行）
# 3. Brain coverage 校验：人工移除某步 → 整体 FAIL（Brain 代码拦截，非 LLM 自判）
# 4. 回退开关：EVALUATE_PATH=legacy → 走旧 evaluator spawn 路径（不跑新代码执行段）
# 5. 本 sprint 自身 E2E 由新执行器跑、新裁读 LLM 判（self-referential 验收）
```

## journey_type: autonomous
## journey_type_reason: 纯 Brain 后端改动，evaluateContractNode 在 packages/brain/src/workflows/
## target_environment: local_api
## target_environment_reason: 本地 Brain API（curl localhost:5221）+ node 单测，无 UI 或 Windows runner
## journey_id: (来源 task.payload.journey_id，Brain 派发时注入)
## step_id: L00-S4（Cecelia Harness Pipeline — evaluate 职责分离阶段）
