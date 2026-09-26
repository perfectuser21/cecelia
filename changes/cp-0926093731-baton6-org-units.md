## Brain {VERSION} — org_units 组织真身骨架：company→department→leader→members 自动升格模型（链 bf5088a3 棒6，任务 80e9f816，决策 de1e9ba9）

- 病根：组织架构无真相源（部门信息散在 3 处文件，agent 24 个平级，OKR 部门列/部门卡/agent 清单三套口径互相矛盾），Brain 无 `org_units`/`departments`/`companies`，只有 `dept_configs` 4 列 1 行。
- 主理人 2026-09-26 拍板（否定填清单/否定自动反推）：建一个从 0 到大的自动升格模型，起点只种一行代表当前真实状态，department 不手工建，靠"存活法则"（复用决策 ca3c6755：7 天试用期，连续 3 天无交卷证据自动降级，反过来达标则升格）从 Area 自动升格。
- 迁移 473：新增 `org_units`（`unit_type` company/department + CHECK、`parent_id` 自引用、`area_id` 关联 `areas`、`status` active/incubating/demoted + CHECK）+ 轻表 `org_unit_members`（`member_type` agent/human + CHECK，human 只在真人加入时手工插行，不预建空位）；幂等种一行 company（name='Cecelia/ZenithJoy'，leader='Alex'，不编造部门/人员清单）。
- `packages/brain/src/lib/org-unit-promotion.js` 导出纯函数 `evaluateAreaForPromotion(areaId, opsStats)`：按 `{recentDays:[{date,hasEvidence}]}` 判定最近 7 天试用窗口内是否触发连续 3 天无证据的降级阈值，只判定不查库、不接调度、不自动建 department 行。
- 新增只读端点 `GET /api/brain/org-units`：返回 company→department 树 + 每个 unit 的成员计数（agent/human），供以后"AI 掌握公司信息"用；`POST /api/brain/org-units/promotion-check` 暴露 `evaluateAreaForPromotion` 供预览判定（不查库不写库）；挂载于 `server.js`（`app.use('/api/brain', orgUnitsRouter)`）。
- 测试：`org-unit-promotion.test.js`（9 例，纯函数判定含数据不足/连续降级/滑动窗口边界）+ `routes/org-units.test.js`（5 例，mock pool，树形聚合/父子挂载/500 兜底/promotion-check 转发）+ `migration-473-org-units.test.js`（6 例，结构断言）；新增 `org-units-smoke.sh` 登记入 `smoke-allowlist.txt`。
- 未做（留给下一棒，已写入任务 handoff）：升格执行（读 Area 活跃数据接线 + 定时评估 job + 自动建 department 行）、org_units 树接进 `/api/brain/context` 主提示词、飞书/Notion/ORGANIZATION.md 三投影（原始任务 ca2d0b58 范围，本棒范围收窄自决策 2e756506）。
