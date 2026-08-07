# GAN Round 1 Reviewer 反馈 — REVISION

Sprint: 08070516-relay-2c482ed6（修复 ledger-hygiene m2 口径失真）
Reviewer 实证动作：读源码锚点（ledger-hygiene.js:26/:83-109/:352-361、capture-triage.js:162、smoke 脚本 :25/:33/:41/:49、smoke-ledger-hygiene.mjs 表格式）全部吻合；等深路径副本真跑合同测试复证真红 **4 failed / 2 passed**；bash -n 与全角紧贴检测通过；BEHAVIOR 计数 7 ≥ 4。

## RUBRIC SCORES

```json
{
  "dod_machineability": 5,
  "scope_match_prd": 9,
  "test_is_red": 8,
  "internal_consistency": 6,
  "risk_registered": 9,
  "verification_oracle_completeness": 9,
  "ci_workflow_alignment": 10
}
```

- **DoD 机检性 = 5**：A1-A4、B1-B4、B6-B7 均真实可执行；但 Golden Path Step 6 / Test Contract 引用的命令 `cd packages/brain && npx vitest run ../../sprints/.../ledger-hygiene-m2-noise.test.js` 经实跑输出 **"No test files found, exiting with code 1"** —— `packages/brain/vitest.config.js` include 注释明写「sprints/** 已于 07-10 大扫除中移除」。该命令**绿态也永远 exit 1**，Step 6 硬阈值「vitest 全绿 exit 0」不可能达成，属假验证命令。
- **Scope 匹配 PRD = 9**：Step 1-6 与 PRD Golden Path/边界/验收点 1-6 严格 1:1；Step 6 [AI_ADDED] 有 PRD:20「复用共享常量模式」+ INV-2/INV-10 铁律依据，非蔓延。
- **Test 真红 = 8**：Reviewer 独立复证测试本体 4 failed/2 passed（与 proposer 报告一致）；真库差分 noise 场景红证据（462→466 FAIL）逻辑自洽。命令路径缺陷已在第 1 维扣，不重复扣。
- **内部一致 = 6**：三处歧义见下方问题 1-3。
- **风险登记 = 9**：失败语义 3 条各有 mitigation，判定点 J1-J3 误判后果齐全，并发漂移「重试 1 次非兜底放行」策略明确。
- **Verification Oracle 完整性 = 9**：非 HTTP 任务等价 oracle 已 codify：同 tag 注入→重算差分（psql 真库 + node 真跑，自带时效性防历史冒充），E2E 以真执行断言为主；误伤双侧（real-miss/issue-real-miss）+ 双重计数（harness-once）+ 常量同源全覆盖；禁 mock 边与规则 C 清单齐备。
- **CI Workflow 对齐 = 10**：target_environment=local_api，N/A。

## 收敛状态（Round 1）

- 上轮我提的阻塞问题：N/A（首轮）
- 本轮已解决：N/A
- 仍阻塞：0
- 本轮新增阻塞问题：3 个（均为验证命令不可执行/合同文本歧义，非"锦上添花"）
- 合同行数：本轮 280（含 73 行内嵌 E2E 脚本，实体规范部分 ~200；提醒下轮只做定点修正，勿再膨胀）

## VERDICT: REVISION

阈值 7/10：dod_machineability=5、internal_consistency=6 未达标。

### 需要 Proposer 修的（只列 block 项）

**问题 1**（维度：DoD 机检性，当前 5，目标 ≥ 7）
**描述**：Step 6 与 Test Contract 红证据命令对 `sprints/**` 路径跑 vitest，但 brain vitest include 不覆盖 sprints/**（07-10 已移除，config 内有注释），实跑 "No test files found, exit 1"——无论实现好坏永远红，硬阈值「全绿 exit 0」不可达成。
**修复**：Step 6 验证命令改为对落位副本执行（与 B5 同一条：`npx vitest run src/__tests__/ledger-hygiene-m2-noise.test.js`），红证据复现方式注明「等深临时副本」或引用 B5 落位后的命令；Test Contract 表同步更正。

**问题 2**（维度：内部一致，当前 6，目标 ≥ 7）
**描述**：ARTIFACT A3 授权「import 路径改写为 '../ledger-hygiene.js'，其余逐字同源」，但测试文件另有 `const MODULE_PATH = '../../../packages/brain/src/ledger-hygiene.js'`（供动态 import）。副本落位 `src/__tests__/` 后该相对路径解析为 `packages/packages/brain/...` 断裂，B5 必红；而 CONTRACT-IS-LAW 下 Generator 无授权改「其余逐字同源」部分——授权文本与可通过性自相矛盾。
**修复**：A3 显式列出两处改写点：静态 import 语句 + MODULE_PATH 常量，其余逐字同源。

**问题 3**（维度：内部一致）
**描述**：规范§2 对 issues 子查询明确「total 同步排除，防分母污染」，§3 对 tasks 子查询的两类排除（自产 [紧急]、smoke_tag）未写明 total 是否同步排除。不写明则 Generator 可只在 debt FILTER 加谓词，value 分母仍被噪声稀释，且现有测试（mock 行值驱动）与真库差分（只断 debt）均无法机检该歧义。
**修复**：§3 补一句「debt 与 total 同步排除」（与§2 对齐），必要时在单测 mock 断言 SQL 文本中锚定谓词位置。

### 非新增要求确认（回应 proposer concern#3）

既有 ledger-hygiene.test.js:69-78 旧口径 m2 断言（debt=4, value=14/18）的同步更新授权边界**核对通过**：授权仅限该断言镜像更新为停计口径（debt=3, value=12/15，数学正确），A4 机检旧断言不得残留 + B5 新副本全绿双向锁定，不构成「Generator 改测试作弊」通道。此项无需修改。
