# GP6/T6 设计：晨报军师节 v2 五段渲染 + ≤7 截断（battle-report.js）

> 上游 SSOT：docs/architecture/2026-07-12-golden-path-mode/architecture.md ·
> 规格页 https://docs.zenjoymedia.media/strategist-node-v2-spec/（B1/B4/B7 断言）·
> decisions cb6be3f6 / b416bfb3 · Brain task 94246f12。
> 本文只记录实现级决策，不复述上游规格。

## 目标

把 battle-report.js 第⑤段「军师决策（24h）」（v1，notes 明细列表）升级为军师节 v2 五段，
照第⑥段「未确认动作」的三处对称模式落地：buildBattleReportData 取数 / renderBattleReportMarkdown 渲染 / __tests__ 契约断言。

## 五段结构（第⑤段内）

| 段 | 出现条件 | 数据源 |
|---|---|---|
| ① 方向圈选段 | 每周一（上海时区）列候选；非周一渲染「每周一更新」 | `golden_paths status='candidate'`（带编号）+ OKR 缺口全景 `working_memory key='gp_gap_panorama'`（value_json={generated_at, gaps:[{kr_id,kr_title,reason}]}，T4 并行约定钉死） |
| ② GP 批审段 | 有 converged 货才出现，否则「暂无」 | `golden_paths status='converged'`；含新型判定点的排前逐行展示，全先例的折叠为一行 |
| ③ 报备段 | 有 auto_release 货才出现，否则「暂无」 | `golden_paths auto_release=true AND veto_deadline > now()`（24h 否决窗倒计时）+ 昨日 `[自动派工]` 台账（`tasks title LIKE '[自动派工]%' AND created_at >= now()-24h`，T5 口径） |
| ④ 验货台段 | **本期不做**，节内不渲染该段（范围外） | — |
| ⑤ GP 库存水位段 | 每日一行 | `golden_paths GROUP BY status` 计数；rejected/blocked_gate 附最新 status_reason |

v1 的 notes 明细列表（`军师决策[线]` 按 Line 分组）被五段**整体取代**（先减肥再增肌）；
`strategistDecisions` 取数与渲染一并删除（全仓仅 battle-report.js 自用，无外部消费者）。

## 实现级决策（上游未钉死处，本文钉死）

1. **新型判定点识别**：DB 无结构化列（判定点登记表在 proposal_doc markdown 内）。
   契约：导出 `hasNovelJudgment(proposalDoc)` —— 解析「判定点登记表」表格行，
   某行的「所选方法/依据」列不含 8-4-4-4-12 UUID 且不含「先例」字样 → 该行新型 → GP 含新型判定点；
   proposal_doc 为空/无登记表 → 视为含新型（保守，排前重点看）。上游将来加结构化列时替换。
2. **首次放行判定**：`golden_paths WHERE auto_release=true AND approved_at IS NOT NULL` 计数为 0
   → 当前否决窗内条目属「首次放行」，计入需动作条目（优先级 2）；否则报备条目为被动知情，不计入 ≤7。
3. **≤7 截断**：需动作条目优先级 1=新型判定点批审行 > 2=首次放行 > 2.5=全先例批审折叠行（规格未排序，
   置于首次放行后、圈选前——批审桌先于菜单）> 3=圈选候选行 > 4=抽检（本期棘轮范围外，恒空但留槽位）。
   超 7 条按优先级截断，被截条目不渲染明细，节尾渲染「⏳ 需动作条目超限，N 条顺延次日（堆积水位）」。
4. **周一判定**：`buildBattleReportData(pool, now = new Date())` 增加可注入 now；
   上海时区 weekday === Monday → `goldenPathMode.isMonday=true`，渲染器据此决定圈选段内容。
5. **降级**：goldenPathMode 整块 try/catch（照第⑤⑥段先例），查询失败 → `goldenPathMode=null`
   → 五段各渲染「暂无」（B1 仍满足：段标题恒在）。
6. **旧数据形状兼容**：`data.goldenPathMode` 缺省（旧调用方形状）渲染不炸（照第⑥段先例）。

## 测试策略（integration 档：vitest + mock pool，照本文件既有测试骨架）

- **B1**：空态 fixture → 四个段标题齐全且各「暂无」，不出现「验货台」；goldenPathMode=null / 缺省同样成立。
- **B4**：9 条需动作 fixture（新型批审 3 + 首次放行 2 + 圈选 4）→ 渲染需动作明细恰 7 条、
  溢出行含「顺延」与堆积数 2、被截的是最低优先级（圈选尾部 2 条）；报备被动条目另行渲染且不占 7。
- **B7**：GROUP BY status fixture → 水位行计数一致；rejected/blocked_gate 带 status_reason。
- 取数契约：golden_paths 三查 + working_memory gp_gap_panorama + tasks [自动派工] SQL 形状断言；
  整块查询抛错 → goldenPathMode=null 且其余段不受影响。
- v1 军师决策旧测试更新为「已被 v2 取代」的负断言（不再渲染 notes 明细）。

## 不包含

- 验货台段（T7）、routes/golden-paths.js 改动、抽检棘轮、飞书富卡片、Dashboard 交互（T7）。
