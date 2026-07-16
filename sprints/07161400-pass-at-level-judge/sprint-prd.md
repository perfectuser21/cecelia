# Sprint PRD — judge 支持 PASS@L 分级判定 + L3 真机指纹证据执法 + 等级回写

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（进度 82%）
- **当前进度**：82%
- **本次推进预期**：84%（harness 执法侧发布准入地基补齐）

## 背景

当前 harness-judge.js 无验证等级概念：任何证据形式（纯 curl / vitest / 真机截图）均可获得 PASS，导致"承诺 L3 真机验收但只跑 curl"的漏洞无人拦截。本 sprint 为 Brain 执法侧补齐三件：① verification_level 字段支持；② L3 步骤必须真机指纹证据；③ 等级落库。

## Golden Path（核心场景）

Evaluator 提交含 `[L3]` 标记步骤的 brainResult → judge 解析等级声明 → 验证证据是否含真机指纹 → 无指纹判 FAIL（mechFail=level_evidence_mismatch）→ PASS 时把各步实际等级写入 judge 输出 coverage + 落 design_docs。

具体：

1. **触发条件**：sprint-prd 的 Golden Path 步骤含 `[L3]` 标记（或 brainResult 顶层 / behavior_tests 条目带 `verification_level:"L3"`）
2. **系统处理**：judge 机械预检时检测等级声明；若声明 L3，校验对应 behavior_tests 条目的 `log_tail` / `screenshot` 字段含真机指纹关键词（设备路径 / UIA 标识 / 截图路径）；纯 curl/vitest 输出 → 判 FAIL mechFail=level_evidence_mismatch
3. **可观测结果**：
   - FAIL 场景：`runMechanicalPreflightChecks` 返回 `{verdict:'FAIL', mechFail:'level_evidence_mismatch', feedback:'...'}`
   - PASS 场景：judge 输出 JSON 的 `coverage[i].verification_level` 写实际达到等级；落 `design_docs` 表一条 type='judge_level_report'
   - 存量无标记格式：行为不变（L2 兼容，不 breaking）

## 边界情况

- brainResult 无 `verification_level` 字段 → 默认 L2，不 FAIL（兼容存量）
- behavior_tests 条目含 `verification_level` 覆盖顶层值
- 顶层与条目级同时存在时，条目级优先
- `log_tail` 含 "curl" 前缀但同时含设备路径关键词 → 判 PASS（不过度拦截）

## 范围限定

**在范围内**：
- `packages/brain/src/harness-judge.js`：① verification_level 解析；② L3 证据机械预检；③ coverage 等级字段 + design_docs 落库
- 对应 `packages/brain/src/__tests__/` 下新增 failing → passing 测试（禁 mock 证据解析路径）

**不在范围内**：
- 合同/skill 文本侧（L3 标记写入 sprint-prd 模板）→ 另件 W3 zenithjoy-skills 仓
- 新建数据库表（禁自造表，无合适列则写 judge 输出 JSON + 落 design_docs）
- evaluator 侧改动

## 假设

- [ASSUMPTION: sprint-prd Golden Path 段的 [L3] 标记由 proposer 写入，judge 只负责解析执行，不负责生成标记]
- [ASSUMPTION: initiative_runs / decisions 现有列不新增 verification_level 专列；等级数据写入 judge 输出 JSON coverage 字段并落 design_docs 表（type='judge_level_report'）]

## 预期受影响文件

- `packages/brain/src/harness-judge.js`：三处修改（verification_level 解析 + L3 机械预检 + coverage 等级写库）
- `packages/brain/src/__tests__/harness-judge-level.test.js`（新建）：failing → passing 测试 + 兼容回归

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
<!-- area 级有 19 条活跃 invariant，但 title/content 字段当前为空（数据未录入）→ 按规则占位 -->
- （本 line 暂无历史 step/feature 级 invariant）
- [area 级] 19 条 area invariant 已存在但 title/content 为空，无法提取具体文本；proposer 执行前应补录或跳过（不阻塞）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey_id 为空（非路径 C 点火），无法查 journey golden-paths，优雅降级 -->
（本 line 暂无历史——journey_id 未注入，无累积 FR 可加载）

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟：不适用（纯同步机械预检，无外部调用新增）
- 兼容性：存量 brainResult 无 verification_level 字段时行为不变（L2 默认，不 breaking）
- 测试要求：failing test 先行，禁 mock 证据解析路径，修复后必须进 CI 永久留存

## E2E 验收

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1. 构造 brainResult：声明 [L3] 步骤 + 证据纯 curl 输出
#    → 修复前：现版本 PASS（failing test）
#    → 修复后：FAIL，mechFail=level_evidence_mismatch
# 2. 构造存量 brainResult：无 verification_level 字段
#    → 行为不变（兼容回归 PASS）
# 3. 构造 L3 + 含真机指纹关键词证据
#    → PASS，coverage[i].verification_level='L3'
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain/src/ 后端逻辑修改，无 UI/Dashboard 变化
## target_environment: local_api
## target_environment_reason: 仅 harness-judge.js + Brain API 本地验证（curl localhost:5221 + vitest unit）
## journey_id: none
## step_id: none（PrepPRD 未锚定）
