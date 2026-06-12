# Sprint PRD — E2E 代码执行 + LLM 裁读（evaluator 职责分离）R4

## OKR 对齐

- **对应 KR**：Harness Pipeline 可信执行（Deterministic Gate 7 条中第 4/7 条）
- **当前进度**：前三发已完成门前置（Contract Gate），本发完成执行/裁读职责分离
- **本次推进预期**：Deterministic Gate 4/7 条验证通过

## 背景

LLM evaluator 亲手执行 E2E 脚本存在"假装跑过"风险。前三发：R1 回调断裂、R2 钝规则窗口、R3 ARTIFACT 门依赖误判（#3364 已修：NODE_PATH 注入 + 依赖错误 fail-open）。本发在已稳合同门基础上完成职责分离：命令执行归代码，语义裁读归 LLM，AI 想"假装跑过"没有机会。

## Golden Path（核心场景）

用户提交合同 E2E 脚本 → 系统代码执行留记录 → LLM 只读记录下裁读结论

1. **触发**：evaluate 节点收到合同（含通过型 E2E 脚本）
2. **代码执行**：系统在 cecelia/runner 容器内以代码方式执行脚本（复用 runScenarioCommand/execFile），逐段落盘结构化执行记录（exit/stdout/stderr/耗时/环境）
3. **LLM 裁读**：执行记录 + 合同 + Golden Path 交轻量 LLM；LLM 不执行任何命令，仅输出 verdict=PASS + 覆盖对照表 JSON（每步→对应记录段→通过否）；Brain 校验覆盖对照表缺步即 FAIL
4. **失败路径**：失败型 fixture → 执行记录如实捕获失败 → LLM 裁读 verdict=FAIL + failed_step + 修复方向（引执行记录原文）
5. **出口**：.brain-result.json 写盘（EvaluatorOutputSchema 兼容，扩展 coverage 字段）；执行记录与裁读输出按运行实例落盘（#3345 协议）

## 边界情况

- LLM 裁读超时/报错 → verdict=FAIL，不回退旧路径
- 执行记录为空（脚本无输出）→ verdict=FAIL，不交 LLM
- 回退开关：env `EVAL_LEGACY=1` 或 payload `use_legacy_eval: true` → 走旧路径
- 成本约束：裁读 token 量控制，目标 < $2/轮

## 范围限定

**在范围内**：local_api / playground / mac_web 三类 target_environment 的 evaluate 流程职责分离；通过型 + 失败型两种 fixture；回退开关；self-hosting 自验

**不在范围内**：windows_cloud / linux_server E2E；fix loop 语义变更；Contract Gate 本身修改

## 假设

- [ASSUMPTION: runScenarioCommand/execFile 封装已存在，本发复用不重写底层]
- [ASSUMPTION: cecelia/runner 容器 mount/env/localhost 重写已稳定]
- [ASSUMPTION: .brain-result.json 写盘协议（#3345）已实现，本发只扩展 coverage 字段]
- [ASSUMPTION: 断言写法遵循 gate 成熟规则，负向测试/捕获断言/状态码 oracle 均可被识别]

## 预期受影响文件

- `packages/engine/src/harness/evaluate.js`（或同层 evaluator 节点）：职责分离主逻辑
- `packages/engine/src/harness/runner.js`（或 runScenarioCommand 入口）：执行记录落盘扩展
- `packages/engine/src/harness/e2e-judge.js`（新增）：LLM 裁读模块（只读记录，不执行）
- `packages/engine/tests/harness/evaluate.test.js`：单测（记录 schema / 覆盖表校验 / 节点流程 / 回退开关）+ fixture

## E2E 验收

> Planner 初稿占位。**最终可执行脚本由 proposer 在 GAN 阶段产出（target_environment=local_api → bash + curl + 文件校验）。**

```bash
# 占位：proposer 按 target_environment=local_api 填入真实命令
# 期望验收点（自然语言）：
# 1. 触发含通过型脚本的 evaluate → 执行记录文件存在，exit=0，stdout 非空
# 2. .brain-result.json verdict=PASS，coverage 字段含全部 Golden Path 步骤条目
# 3. 触发失败型 fixture → verdict=FAIL，failed_step 非空，修复方向引用记录原文
# 4. 本 sprint 自身 E2E 脚本由新执行器运行、新裁读输出 verdict=PASS（self-hosting）
# 5. 设 EVAL_LEGACY=1 → 旧路径生效，新执行器不介入（回退开关验证）
```

## journey_type: dev_pipeline
## journey_type_reason: 本发修改 harness evaluate 节点（packages/engine/ 执行/裁读流程），属开发工作流引擎
## target_environment: local_api
## target_environment_reason: 后端 harness 执行器在本地 Brain/runner 容器运行，E2E 验收走 curl + 本地文件校验（localhost）
## journey_id: <来源 task.payload.journey_id — Brain API 当前不可达，proposer 从 task payload 补填>
## step_id: <来源 PrepPRD Golden Path 锚定 — harness evaluate 步骤，proposer 补填>
