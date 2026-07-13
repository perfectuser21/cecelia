# capture-triage scope 分诊设计（修订 57d296a1）— GP loop T5

任务: 6c2abb4b-2d97-4cd3-8273-9031cbfe3982（golden-path-mode GP5/7）
架构 SSOT: docs/architecture/2026-07-12-golden-path-mode/architecture.md（capture-triage 条目 + 关键决策表「T16 自动派工→scope 分层收编」）
PrepPRD: sprints/07121309-capture-triage-scope/prep-prd.md
验收: initiative-dod.md F12/F13
修订决策已落库: decisions b2eeb1b5（引用 57d296a1 + cb6be3f6）— F13 ✅

## 目标

line_backlog 路由增加 scope 维度（repair|capability）：
- **repair**（FAIL 类/回归/既有 ability 小改）→ 维持 57d296a1 自动派工，零行为变化
- **capability**（新方向/新能力/新平台语义）→ 不再 createTask，写 golden_paths(candidate, source='capture_triage') 收编为 GP 方向菜单输入源

## 设计（全部改动在 packages/brain/src/capture-triage.js）

### 1. classifyScope(atom) — 新增导出函数（cheap rules）

```
capability 关键词正则命中（新方向|新能力|新平台|新业务|从零|立项 等）→ 'capability'
否则 target_subtype ∈ {FAIL, PASS+NEXT} → 'repair'
否则 → null（拿不准，走 LLM）
```

- capability 关键词**优先于** FAIL/PASS+NEXT：语义含新方向的交接应进 GP 菜单（可逆——人工圈选即恢复；反向误判=自动开工本应批审的方向，代价更高）
- PASS+NEXT 直接判 repair（cheap rule 覆盖明确 case 省 LLM 成本，架构意图）

### 2. LLM 兜底 — TRIAGE_LLM_PROMPT 扩展

prompt 增加说明：route=line_backlog 时额外输出 `"scope":"repair|capability"`。
runCaptureTriage 中 scope 拿不准且 LLM 可用 → 调 LLM 取 scope；LLM 关闭/失败/输出非法 → **默认 'repair'**（完全保持 57d296a1 现状；误判后果有 isProductionSensitive 护栏 + CI + code-review + 次日验货兜底，非静默不可逆——判定点登记表已记录）。

### 3. line_backlog 分支流程（routeAtom）

```
journey 查找 + no_journey 留箱   —— 不变（零回归）
→ classifyScope / LLM scope
→ scope='capability' → GP 收编路（见 4），生产护栏不适用（此路不产生自动开工）
→ scope='repair'   → 现状原样：isProductionSensitive 护栏 → createTask（[自动派工] 前缀、
                     dedupe_key、harness_initiative payload 全部零改动）
```

capability 判定**优先于**生产护栏（含"新平台"又含"生产环境"的 atom 进 GP 菜单比留箱更符合收编意图），用测试锁定。

### 4. capability 路落地（照 invariant 路事务模式）

- 幂等锚：`SELECT id FROM golden_paths WHERE status_reason LIKE '%atom:<id>%'`，命中则只补 atom 指针
- 事务内 INSERT + updateAtom（任一失败 ROLLBACK）：
  - `golden_paths(title=content 前 80 字, one_liner=content 前 200 字, journey_id, status='candidate', source='capture_triage', status_reason='capture-triage atom:<id>')`
  - `updateAtom(status='confirmed', routed_to_table='golden_paths', routed_to_id=<gp id>, aiReason='[triage:capability] 收编 GP 候选 …')`
- **FK 容错**：journey_id 来自 tasks.payload（text 无 FK 保证），INSERT 抛 FK/cast 错误时按 no_journey 语义留箱（`[triage:no_journey]`），不让脏数据反复占用重试

### 5. 晨报口径保障（任务⑤）

`[自动派工]` title 前缀零改动，T6 查询口径 `tasks WHERE title LIKE '[自动派工]%' AND created_at 窗口` 保持可用；测试断言锁住前缀。

## 不包含

- capture_atoms schema 变更（scope 结果进 ai_reason 前缀 `[triage:capability]`，架构文档明确）
- urgent/invariant/okr 三路改动
- golden_paths 表/端点改动（T1 已交付）
- 晨报渲染（T6 范围）

## 测试策略（unit 档，复用既有骨架）

`src/__tests__/capture-triage.test.js`（makePool mock 骨架 + vi.mock actions/invariant-gate）：

1. classifyScope 单测：FAIL→repair、PASS+NEXT→repair、含"新平台"→capability、关键词优先于 FAIL、其余→null
2. repair fixture（handoff FAIL 普通内容）：createTask 被调用 + title 以 `[自动派工] ` 开头（晨报口径锁）+ payload/dedupe_key 与 T16 断言一致（回归锁）
3. capability fixture（内容含"新平台"）：createTask **不**被调用 + golden_paths INSERT 参数（candidate/capture_triage/journey_id/status_reason 含 atom id）+ atom 更新含 `[triage:capability]` + routed_to_table='golden_paths'
4. capability 优先于生产护栏：内容含"新平台"+"生产环境" → 走 GP 收编不走留箱
5. 幂等：已存在同 atom 锚的 golden_paths → 不重复 INSERT，只补指针
6. FK 容错：INSERT 抛错 → ROLLBACK + `[triage:no_journey]` 留箱
7. LLM scope 扩展：cheap rule 拿不准（构造 LLM 路由来的 line_backlog）→ LLM 返回 scope=capability 走 GP 路；LLM 失败 → 默认 repair
8. 既有全部测试保持绿（零回归）

## 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| scope 分类 | A 纯关键词 / B 规则+LLM 兜底 / C 纯 LLM | B（架构指定） | 明确 case 省成本，模糊走 thalamus | repair→capability：进菜单等圈选（可恢复）；capability→repair：自动开工，护栏+三层事后检查兜底 |
| scope 不可判默认值 | A 默认 repair / B 留箱人工 | A | 保持 57d296a1 现状零回归；留箱会把普通 FAIL 堆进人工队列违背零人为交互 | 同上行 capability→repair |
