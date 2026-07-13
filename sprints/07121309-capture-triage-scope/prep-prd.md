# 小改动 PrepPRD：capture-triage scope 分诊（修订 57d296a1）— GP loop T5

任务: 6c2abb4b-2d97-4cd3-8273-9031cbfe3982（golden-path-mode plan, GP5/7）
设计 SSOT: docs/architecture/2026-07-12-golden-path-mode/architecture.md（capture-triage 条目）
验收: initiative-dod.md F12/F13

## 改什么

`packages/brain/src/capture-triage.js`：

1. **verdict 增加 scope 维度（repair|capability）**，仅对 route=line_backlog 生效：
   - cheap rules 先判：
     - `handoff FAIL`（FAIL 类 learning/回归/既有 ability 小改语义）→ `scope='repair'`
     - 内容含新方向/新能力/新平台语义（如「新平台」「新能力」「新方向」「从零」「立项」等关键词）→ `scope='capability'`
     - `handoff PASS+NEXT` 默认 repair，除非命中 capability 关键词
   - cheap rules 拿不准 → 既有 thalamus LLM 分类 prompt 扩展输出 scope 字段
2. **line_backlog + repair**：维持 T16 现状（createTask harness_initiative 自动派工 + isProductionSensitive 护栏 + dedupe_key），零行为变化，回归测试锁住。
3. **line_backlog + capability**：不再 createTask，改为 INSERT golden_paths(status='candidate', source='capture_triage', journey_id=atom 来源 journey, title/one_liner 取 atom content)，atom 标 `[triage:capability]`、routed_to_table='golden_paths'。
4. **修订决策落库**：POST strategic-decisions「57d296a1 scope 分层修订」，引用 57d296a1+cb6be3f6（PrepPRD 落地时执行，F13）。
5. **晨报口径保障**：`[自动派工]` title 前缀保持不变（T6 渲染查询 `tasks WHERE title LIKE '[自动派工]%' AND created_at 窗口` 可用），加断言锁住前缀。

## 为什么改

决策 57d296a1 的无差别自动派工存在 capability 级借道直发=绕过 GP 批审的后门。架构拍板（关键决策表「T16 自动派工→scope 分层收编」选 B）：repair 级自动派工=报备制五条件（b416bfb3）的退化形态予以保留；capability 级收编为 GP 方向菜单输入源（golden_paths candidate）。

## 关联上下文

- 相关 Journey：bb8cc561-b3ee-4fec-b74d-2255694bd963（golden-path-mode）
- 相关决策：57d296a1（被修订）、cb6be3f6（GP 七解法）、b416bfb3（报备制五条件）、1998f24b（T16 实现记录）
- 依赖：T1 #3779 已合（golden_paths 表在库）

## 影响范围

- capture-triage tick job 的 line_backlog 分支（repair 路零变化；capability 路新写 golden_paths）
- 不改 urgent/invariant/okr 三路；不改 capture_atoms schema（scope 结果进 ai_reason 前缀）
- brain 版本 bump + 迁移无需新增

## 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| scope 分类（repair vs capability） | A: 纯关键词规则 B: 规则先判+LLM 兜底 C: 纯 LLM | B（架构文档指定） | cheap rules 覆盖明确 case 省 LLM 成本；语义模糊走 thalamus | 误判 repair→capability：少派一次工，GP 菜单里等圈选（可恢复）；误判 capability→repair：自动开工一个本应批审的方向（有 CI+code-review+次日验货兜底，非静默不可逆） |

## 验收标准

- [ ] F12: repair 级 fixture atom → createTask 被调用（与 T16 现状断言一致，回归锁）
- [ ] F12: capability 级 fixture atom → createTask 不被调用，golden_paths INSERT(candidate, source='capture_triage', journey_id)，atom ai_reason 含 [triage:capability]
- [ ] F13: decisions 表存在「57d296a1 scope 分层修订」记录，引用 57d296a1+cb6be3f6
- [ ] `[自动派工]` title 前缀有测试断言锁住（晨报 T6 查询口径）
- [ ] CI 全绿
