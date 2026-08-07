# Contract DoD — W3 裁决 API + 聚合分流建任务（D4 后端）

**Task ID**: `6548d9bf-79ee-440e-bcd9-fbf9dcadf8fa`
**版本**: v1（首轮）

---

## DoD 完成条件

本任务 Done 的唯一判据是以下所有条目全部打勾：

### 代码交付

- [ ] `packages/brain/src/routes/acceptance-adjudication.js` 已创建，实现 FR-1/FR-2
- [ ] `packages/brain/src/acceptance-divert.js` 已创建，实现 FR-3/FR-4/FR-5/FR-6
- [ ] `packages/brain/src/routes/acceptance.js` 已更新：
  - [ ] `registerAdjudicationRoutes` 注册到 router
  - [ ] `/runs/:run_key/abandon` 增加 adjudicated/stale 前态守卫（FR-7）
- [ ] 代码无 `'S13-c4'` 硬编码字符串（grep 清零）
- [ ] 无 `console.log` 遗留（`console.error` 在错误路径保留）

### 测试交付

- [ ] `packages/brain/src/__tests__/acceptance-adjudication.test.js` 存在，覆盖：
  - [ ] 输入校验（BEHAVIOR-1/2/3）
  - [ ] 裁决写入 + 重算（BEHAVIOR-4/5/6/7）
  - [ ] unverifiable 例外（BEHAVIOR-8/9/10/11）
  - [ ] abandon 前态守卫（BEHAVIOR-20/21/22/23）
- [ ] `packages/brain/src/__tests__/acceptance-divert.test.js` 存在，覆盖：
  - [ ] 分流触发时点（BEHAVIOR-12）
  - [ ] 聚合 bug/trace 任务（BEHAVIOR-13/14）
  - [ ] bucket 独立查重（BEHAVIOR-15）
  - [ ] anchor 三件套（BEHAVIOR-16）
  - [ ] 熔断互斥（BEHAVIOR-17）
  - [ ] AI 哑火路径（BEHAVIOR-18）
  - [ ] SAVEPOINT 隔离（BEHAVIOR-19）
- [ ] 所有新增测试通过（`npm test` / `vitest run` 绿）

### CI

- [ ] `brain-ci.yml` 绿
- [ ] PR 已 push 到分支 `cp-08071826-ws-6548d9bf`

### E2E 验收（最终上线门槛）

以下 8 条须 psql/curl 双证，全部通过：

- [ ] E2E-1：裁决写入四字段落库
- [ ] E2E-2：unverifiable 例外不开 P0 + 单头注记存在 + hard 非 unverifiable 格对照开 P0
- [ ] E2E-3：分流建任务聚合（bug=1/trace=1）+ anchor 三件套非空 + bug 描述含所有红格
- [ ] E2E-4：bucket 独立查重（bug 不重建，trace 独立新建）
- [ ] E2E-5：熔断只开规程 P0，无 bug/trace 任务
- [ ] E2E-6：AI 哑火走 ai_run_infra_error，无 bug/trace 任务
- [ ] E2E-7：SAVEPOINT 隔离，第一条 INSERT 23505 后第二条仍落库
- [ ] E2E-8：adjudicated/stale abandon 返回 409，pending abandon 返回 200

---

## 行为条目计数

**[BEHAVIOR] 总计：23 条**（BEHAVIOR-1 到 BEHAVIOR-23）

---

## 不变量覆盖确认

| 不变量 | 覆盖测试 | 状态 |
|---|---|---|
| INV-1 裁决四字段缺一 400 | acceptance-adjudication.test.js | 待实现 |
| INV-2 verdict 非法值 400 | acceptance-adjudication.test.js | 待实现 |
| INV-3 非 human_complete 前态 409 | acceptance-adjudication.test.js | 待实现 |
| INV-4 unverifiable 不开 P0 | acceptance-adjudication.test.js + E2E-2 | 待实现 |
| INV-5 禁硬编码格号 | grep 静态检查 | 待实现 |
| INV-6 分流触发点 = adjudicated 后 | acceptance-divert.test.js | 待实现 |
| INV-7 bug/trace 各桶 ≤1 任务 | acceptance-divert.test.js + E2E-3/4 | 待实现 |
| INV-8 anchor 三件套非空 | acceptance-divert.test.js + E2E-3 | 待实现 |
| INV-9 熔断时只开规程 P0 | acceptance-divert.test.js + E2E-5 | 待实现 |
| INV-10 AI 哑火走 infra_error 路径 | acceptance-divert.test.js + E2E-6 | 待实现 |
| INV-11 每条 INSERT 独立 SAVEPOINT | acceptance-divert.test.js + E2E-7 | 待实现 |
| INV-12 adjudicated/stale 禁 abandon | acceptance-adjudication.test.js + E2E-8 | 待实现 |
