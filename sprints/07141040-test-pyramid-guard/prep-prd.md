# 小改动 PrepPRD：刀0 — test-pyramid-guard 机械守卫 + 状态面板复活

> 来源：docs/prd/2026-07-14-ops-half-loop.prd.md 刀0节（Brain task 596e6946）

## 改什么
1. 新增 `scripts/test-pyramid-guard.mjs`，三断言：
   - 断言1（孤儿棘轮）：`sprints/**`（排除 archive）下 `*.test.*` + `e2e-verify.sh` 数量
     不得超过基线 `scripts/test-pyramid-baseline.json`（刀1 入册后基线降到 0，只许降不许升）
   - 断言2（smoke 挂跑道）：`scripts/smoke/*.sh` 每条必须被至少一条跑道引用
     （.github/workflows/**、scripts/brain-deploy* 等部署路径）
   - 断言3（永久池棘轮）：永久测试文件计数（packages/brain vitest include 各根 +
     packages/quality）只许增不许减；退役需显式改基线并在 commit message 声明
2. 输出模式：`--json` 给面板/巡检消费；默认人读文本 + 非零退出码
3. 跑在三处：
   - ci.yml 新增轻量 job（全 PR 必跑，秒级）
   - nightly-regression.yml（刀A）加一步（每日兜底）
   - 手动 `node scripts/test-pyramid-guard.mjs`
4. 复活僵尸面板：guard 通过后调 `scripts/write-current-state.sh` 的调用链接回
   ——在 nightly-regression（每日）里执行并把金字塔三层计数/孤儿数写入
   CURRENT_STATE.md 新增「测试金字塔」段（治 05-22 停更根因=无调用方）

## 为什么改
PRD 刀0：不先能看见就没法施工验收刀1-3；07-10 摘 include 类事故需 CI 当场拦截。

## 影响范围
- 纯新增脚本 + CI job + CURRENT_STATE 生成段；不动 harness 编排、不动 brain 运行时代码
- Dashboard 页面（apps/dashboard）不在本 PR，作为刀0 后续增量另立

## 验收标准
- [ ] guard 三断言各有单元测试（failing test 先行，TDD 两段 commit）
- [ ] proven-to-fire：故意制造孤儿超基线/摘一条 smoke 跑道引用，亲眼看 guard 报红
- [ ] ci.yml 每 PR 跑 guard；nightly-regression 每日跑 guard+写 CURRENT_STATE
- [ ] CURRENT_STATE.md 含「测试金字塔」段且 generated 时间为当天
- [ ] CI 全绿
