# Sprint PRD — evaluate 职责分离：代码执行 E2E + 轻量 LLM 裁读

## OKR 对齐

- **对应 KR**：Harness Pipeline 可信度 KR（Contract Gate 第 4/7 条）
- **当前进度**：Contract Gate 前 3 条已落地（#3348/#3350/#3351）
- **本次推进预期**：完成第 4 条——执行与裁读完全分离，消除"LLM 假装执行"风险面

## 背景

当前 `evaluateContractNode` 由 LLM 直接执行合同 E2E 脚本，存在"LLM 变通执行/跳过命令"的固有风险。#3348 Contract Gate 已在 spawn evaluator 前做确定性预检；本 sprint 完成最后一步：命令执行归代码，语义裁读归 LLM。前次 run 19832d0b 因 GAN 回调链断裂停滞，PrepPRD 不变，R2 重发。

## Golden Path（核心场景）

系统从 [evaluateContractNode 入口] → [代码执行 E2E + 落盘记录] → [LLM 裁读记录] → [verdict + coverage 对照表写盘]

**通过型路径：**
1. 合同（含通过型 E2E 脚本）进入 evaluate 阶段 → 代码（非 LLM）在 runner 容器内执行脚本，逐命令捕获 exit code / stdout / stderr（截断可控）/ 耗时，落盘结构化执行记录文件（遵循 #3345 命名协议）
2. 执行记录 + 合同内容 + sprint-prd Golden Path 送入轻量 LLM 裁读 → 输出 verdict=PASS + Golden Path 覆盖对照表（JSON：每 Golden Path 步骤 → 执行记录中对应命令 → 通过与否）
3. Brain 代码校验对照表：每个 Golden Path 步骤必须有映射命令，缺任一步 → 整体强制 FAIL（代码判，不信 LLM）
4. `.brain-result.json` 写入 `verdict` + 新增 `coverage` 字段；GAN 图后续 fix-loop 语义不变

**失败型路径：**
5. 失败型脚本 fixture → 执行记录捕获非零 exit + 失败 stdout/stderr 原文 → LLM 裁读 verdict=FAIL + 具体 `failed_step` + 修复方向（引用执行记录原文行，不允许 LLM 自行发明错误原因）

**取证：**
6. 执行记录文件 + 裁读输出均按运行实例唯一命名落盘，可完整还原"跑了什么、看到什么、谁下结论"

## 边界情况

- 执行记录 stdout/stderr 超过截断阈值 → 保留头尾，中间截断，不丢 exit code
- LLM 裁读输出 coverage 字段缺失或 Golden Path 步骤数不匹配 → Brain 代码判 FAIL，不依赖 LLM 自述完整性
- 回退开关（env `EVALUATOR_LEGACY=1` 或 payload `evaluator_mode: legacy`）→ 走旧路径，默认新路径

## 范围限定

**在范围内**：
- `evaluateContractNode` 节点流程改造：Contract Gate（已有）→ 代码执行 E2E → LLM 裁读 → verdict
- 结构化执行记录 schema（逐命令 exit_code / stdout / stderr / duration / env_info）
- `.brain-result.json` 新增 `coverage` 字段 + Brain 代码覆盖校验
- 通过型 + 失败型 fixture 进回归测试
- 单测：执行记录 schema / 覆盖表校验 / 节点流程（gate→exec→judge）/ 回退开关
- 本 sprint 自身 E2E 由新执行器执行、新裁读 LLM 判定

**不在范围内**：
- `windows_cloud` / `windows_wechat` 远程执行路径
- GAN 图 proposer/generator/reviewer 节点改动
- 裁读 LLM prompt 的 rubric/评分维度设计（沿用现有 EvaluatorOutputSchema）

## 假设

- [ASSUMPTION: runner 容器已具备 mount/env 注入与 localhost→host.docker.internal 处理，沿用现有 docker-executor.js 机制]
- [ASSUMPTION: LLM 裁读调用成本目标 < $2/轮，通过精简 prompt（仅输入执行记录摘要而非完整 stdout）实现]
- [ASSUMPTION: Golden Path 步骤数 ≥ 1 且从 sprint-prd.md 解析，不由 LLM 自行推断]
- [ASSUMPTION: #3345 取证命名协议已实现，本 sprint 直接复用]

## 预期受影响文件

- `packages/brain/src/harness-final-e2e.js`：新增/扩展代码执行器函数（复用 `runScenarioCommand` 或等价 `execFile` 封装），落盘执行记录
- `packages/brain/src/workflows/harness-gan.graph.js`：`evaluateContractNode` 节点改造，拆分执行与裁读两步
- `packages/brain/src/__tests__/harness-initiative-evaluate.test.js`：新增通过型/失败型 fixture 单测 + 覆盖校验单测 + 回退开关测试
- `packages/brain/src/lib/contract-gate.js`（只读参考，不改）

## E2E 验收

> Planner 初稿。proposer 在 GAN 阶段按 local_api 模板产出最终可执行脚本写入 contract-draft.md。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1. 通过型 fixture：运行新 evaluateContractNode → 执行记录文件落盘（含 exit_code=0）→ brain-result.json verdict=PASS + coverage 含所有 Golden Path 步骤
# 2. 失败型 fixture：同流程 → 执行记录 exit_code≠0 → verdict=FAIL + failed_step 引用执行记录原文
# 3. coverage 字段缺步强制 FAIL：构造 coverage 少一步 → Brain 校验返回 FAIL，不接受 LLM 自称 PASS
# 4. 回退开关：EVALUATOR_LEGACY=1 → 走旧路径，不触发新执行器
# 5. 本 sprint 自身 E2E 通过新执行器执行并由新裁读 LLM 给出 verdict
```

## journey_type: autonomous
## journey_type_reason: 纯后端 Brain 内部节点（evaluateContractNode），无 UI 也无远端 agent 协议
## target_environment: local_api
## target_environment_reason: Brain 内部 + 纯 API 验证，执行记录落盘在本地，curl localhost:5221 + 文件断言即可
## journey_id: <来源 = task.payload.journey_id，Brain API 当前不可达，由 proposer 从 task 记录补填>
## step_id: <来源 = PrepPRD Golden Path 锚定，L01-evaluate-separation>
