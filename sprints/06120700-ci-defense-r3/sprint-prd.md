# Sprint PRD — Harness CI 防线三件套（R3 重发）

## OKR 对齐

- **对应 KR**：Cecelia Harness Pipeline 稳定性与可验证性
- **当前进度**：规则库四轮进化后（#3351/#3353/#3357/#3358），本次 R3 全新点火
- **本次推进预期**：Deterministic Gate 第 6/7 条完成上线，CI 可自证

## 背景

三个实证漏洞已确认：① `vitest --changed` 漏 fs 读取型测试；② skill 快照不变量无守卫；
③ 合同文件曾未进 main。前两次 run 因部署孤儿化 / sub-graph 死线程复用失败，规则库现已成熟，重发。

## Golden Path（核心场景）

开发者 / CI 从 [变更 skill 文件] → 经过 [四道守卫] → 到达 [CI 红绿可信]

1. **触发**：修改任意 `packages/workflows/skills/**` 文件（如 `harness-evaluator/SKILL.md`）
2. **守卫 1 — fs 依赖路由**：运行 `node packages/brain/scripts/ci/changed-test-router.mjs --files <路径>`
   → 标准输出一份额外测试清单，包含所有 fs 读取依赖该文件的测试 ID
3. **守卫 2 — skill 快照契约**：运行 `vitest run`（skill 契约测试套件）
   → 当前 4 个 skill 快照全绿：evaluator（含 `env_missing` 红线与 B-1.6/1.7/1.8、
   无 ws_id/contract-dod-ws 残留）、reviewer（7 维名与 ReviewerOutputSchema 逐字一致）、
   generator（无可执行 `gh pr merge`）、proposer（含领域验证规则段）
4. **守卫 3 — 篡改必红**：删除 evaluator fixture 的 `env_missing` 段 → 同一 vitest 套件报错，
   指明缺失的不变量名称（非通用失败信息）
5. **守卫 4 — 合同存在性**：运行合同存在性脚本，传入缺 `contract-draft.md` 的 diff fixture
   → 非零退出并指明缺失路径；传入完整 diff → 零退出
6. **CI 接线**：`brain-ci.yml` 对 `packages/workflows/skills/**` 变更新增 job step，
   依次执行上述脚本与 vitest；CI yaml 通过语法校验（`npx js-yaml` 或等效工具）

## 边界情况

- 注释行（`#` 起头）不参与 gate 扫描，不触发误报
- 负向测试用 `&& { ...; exit 1; } || true` 或 `LOG=$(cmd || true)` 后 5 句内断言 `$LOG`，gate 均已识别放行
- 确属误报可在代码行内加 `gate-allow: <rule-id> <理由>` 豁免

## 范围限定

**在范围内**：
- 新建 `packages/brain/scripts/ci/changed-test-router.mjs`（fs 依赖路由脚本）
- 新增 skill 契约 vitest 测试套件（快照覆盖 4 个核心 skill）
- 新增合同存在性脚本
- `brain-ci.yml` 最小追加（不重构现有 job）

**不在范围内**：
- 重构现有 CI 结构
- 修改 skill SKILL.md 内容本身
- 引入新的外部依赖

## 假设

- [ASSUMPTION: `packages/brain/scripts/ci/` 目录需新建]
- [ASSUMPTION: vitest 已在 monorepo 可用，契约测试放 `packages/workflows/skills/__tests__/` 或同级]
- [ASSUMPTION: 合同存在性脚本接受 `--diff-fixture <file>` 参数或从 stdin 读取 changed 文件列表]

## 预期受影响文件

- `packages/brain/scripts/ci/changed-test-router.mjs`：新建，fs 依赖路由逻辑
- `packages/workflows/skills/__tests__/skill-contract.test.ts`（或 `.js`）：新建，4 skill 快照
- `packages/workflows/skills/__tests__/fixtures/`：新建，evaluator/reviewer/generator/proposer 快照 fixture
- `packages/brain/scripts/ci/contract-existence-check.mjs`（或等效位置）：新建，合同存在性检查
- `.github/workflows/brain-ci.yml`：追加 step，对 `packages/workflows/skills/**` 变更强制跑上述检查

## E2E 验收

> Planner 初稿此区块为自然语言描述，最终可执行脚本由 proposer 在 GAN 阶段产出。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实命令

# 期望验收点（自然语言）：
# 1. changed-test-router.mjs --files packages/workflows/skills/harness-evaluator/SKILL.md
#    → stdout 含额外测试清单（至少一条 test id）
# 2. vitest run（skill 契约套件）→ 全绿，4 skill 覆盖
# 3. 删除 evaluator fixture env_missing 段 → vitest 报红，错误信息含 "env_missing"
# 4. contract-existence-check.mjs --diff-fixture missing.txt → exit 非零
#    contract-existence-check.mjs --diff-fixture complete.txt → exit 0
# 5. npx js-yaml .github/workflows/brain-ci.yml → 无错退出（yaml 语法通过）
```

## journey_type: autonomous
## journey_type_reason: 涉及 packages/brain/scripts/ci/ 纯后端 CI 脚本，无 UI/agent 协议/engine hooks 路径
## target_environment: local_api
## target_environment_reason: vitest + node 脚本均在本地 CI 环境执行，curl localhost:5221 不涉及，纯文件系统验证
## journey_id: (来源 task.payload.journey_id — Cecelia Harness Pipeline Journey)
## step_id: L-CI-DEFENSE-R3
