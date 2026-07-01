# Sprint PRD — 无条件核心回归闸（B1）

## OKR 对齐

- **对应 KR**：Cecelia Harness Pipeline 骨架稳定性
- **当前进度**：待 Brain 恢复后确认
- **本次推进预期**：新增 core-regression 无条件 CI 闸，堵住跨服务耦合的假绿灯漏洞

## 背景

当前 CI 存在路径门洞：Brain（packages/brain/）被打坏时，如果 PR 未改 brain 目录，brain-unit 被跳过，CI 照绿。另有 regression-smoke job 扫空目录（*.golden-smoke.test.ts 不存在），静默 exit 0，从未真正跑过任何回归。本次新增 core-regression 无条件闸，并删除 regression-smoke 僵尸 job。

## Golden Path（核心场景）

开发者推 PR（任意目录改动）→ core-regression job 无条件触发 →  
读取 regression-contract.yaml 中 ≥1 条 must-never-break 用例 →  
执行对应 test_command →  
结果：任一失败则 CI 报错；全通过则 ci-passed 汇总通过。

具体步骤：
1. PR 推送触发 CI，core-regression job 无任何 `if: contains(needs.changes.outputs....)` 路径门
2. scripts/ci/run-core-regression.sh 调用 yq 解析 regression-contract.yaml，按 trigger 档（PR→P0/P1，push-main→全集）过滤条目
3. 空集合守卫：release 档过滤后为空 → exit 1，job 失败（防退化假绿灯）
4. 依次执行每条 test_command；命令引用文件不存在或返回非零 → 立即 exit 1
5. 所有条目通过 → exit 0，core-regression job 成功
6. core-regression 结果纳入 ci-passed needs 列表

## 边界情况

- yq 解析 regression-contract.yaml 失败（yaml 格式错误）→ job fail，报 yq 错误
- test_command 中的测试文件路径不存在 → job fail（不静默跳过）
- regression-contract.yaml 的 release 档集合为空 → job fail（空守卫）
- regression-smoke 扫空目录 → 已删除，不再出现

## 范围限定

**在范围内**：
- 新增 scripts/ci/run-core-regression.sh（yq 解析 + 档过滤 + 执行）
- 新增 ci.yml core-regression job（无路径门 if，push-main 全集档）
- 往 regression-contract.yaml 填 ≥1 条真实 Brain P0 golden path（test_command 指向已 committed 测试）
- 删除 ci.yml 中的 regression-smoke job
- 把 regression-smoke 从 ci-passed needs 换成 core-regression

**不在范围内**：
- A1 动态加载 line context
- A3 evaluator PASS 自动 promotion
- CS 客服专属 golden-path test（跨 ZenithJoy 仓库）
- 真机 tests/rog（P2）

## 假设

- [ASSUMPTION: yq 在 ubuntu-latest CI runner 上可用（自带或 apt install yq），PrepPRD 已确认]
- [ASSUMPTION: regression-contract.yaml P0 条目的 test_command 选 `npm run test --workspace packages/brain -- --testPathPattern=autonomous-sessions` 或同等已有 Brain 测试，需 Proposer 确认具体命令]

## 预期受影响文件

- `regression-contract.yaml`：填入 ≥1 条 must-never-break golden path（P0）
- `scripts/ci/run-core-regression.sh`：新增 yq 解析 + 执行脚本
- `.github/workflows/ci.yml`：新增 core-regression job，删除 regression-smoke job，更新 ci-passed needs

## NFR 约束

<!-- 来源: decisions 表 category=nfr — 查询返回空；PrepPRD 无显式 NFR 值 -->
- 超时/延迟: 待定（PrepPRD 未指定，Proposer 阶段按 brain-unit 先例设 20min）
- 频控: 无
- 版本要求: ubuntu-latest + yq（runner 自带）
- 可观测: 任何失败必须有明确 exit 1 + 人类可读错误消息（不静默）

## E2E 验收

> 最终可执行脚本由 proposer 在 GAN 阶段产出。Planner 在此框定验收点。

```bash
# 占位：proposer 按 local_api 模板填入真实验收脚本
# 期望验收点（自然语言）：
# 1. regression-contract.yaml 含 ≥1 条非空 golden path（node -e readFileSync grep 验证）
# 2. scripts/ci/run-core-regression.sh 本地 bash 跑 exit 0
# 3. ci.yml core-regression job 不含 workspace== 路径门（grep 验证）
# 4. ci.yml core-regression job 含 refs/heads/main 全集档（grep 验证）
# 5. ci.yml 不再含扫 *.golden-smoke.test.ts 的 regression-smoke 逻辑（grep 验证）
# 6. ci.yml ci-passed needs 含 core-regression、不含 regression-smoke（grep 验证）
```

## journey_type: dev_pipeline
## journey_type_reason: 本 sprint 改 CI 流水线（ci.yml + scripts/ci/）= 开发工作流基础设施
## target_environment: local_api
## target_environment_reason: E2E 验收为本地 bash grep + shell 脚本运行，无 GUI 也无远端服务依赖
## journey_id: cecelia-harness-pipeline
## step_id: B1-core-regression
