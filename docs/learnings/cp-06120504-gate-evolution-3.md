# Learning — Contract Gate 规则进化 R3（capture-then-assert 跨语句盲区 + db 时间窗按断言意图分型）

分支：cp-06120504-gate-evolution-3
日期：2026-06-12
关联：#3348 / #3350 / #3351 / #3353（同一条 Contract Gate 规则进化线）

## 背景

`#3353` 把行级规则升级为「逻辑语句归一」后，生产 run fa2b3e21（report-scriptize 合同）又实证两个钝点，致两条 GAN 被误报扣轮次：

- **钝点 A**：`RESP=$(curl -sf ...) || { echo FAIL; exit 1; }` 捕获响应后，值校验落在【下一条逻辑语句】`echo "$RESP" | jq -e ...`。curl-no-jq 只查 curl 所在单语句 → 误报。
- **钝点 B**：`SELECT status FROM journey_features WHERE id='$ID'`（主键定点读）和 `INSERT ... RETURNING id`（写语句）都被 db-no-time-window 要求加时间窗。时间窗本意只防"拿历史冒充本轮产出"。

### 根本原因

**前两次（#3351/#3353）和这次是同一个根因的不同切面：规则把"句法特征"当成了"断言意图"本身。**

- curl-no-jq 把"oracle 必须和 curl 出现在同一条语句"当成了规则；但真实意图是"取了响应就要有值校验"——校验落在哪条语句无所谓。capture-then-assert 是合法的跨语句 oracle 形态，规则的单语句视野放不下它。
- db-no-time-window 把"psql + SELECT/count 且无 interval"当成了规则；但真实意图是"防止聚合/存在性探测扫到历史行冒充本轮产出"。主键定点读读的是确定的一行、写语句写的是确定的行，根本没有历史冒充面——它们撞上规则纯属句法误伤。

句法特征是意图的【影子】，不是意图。用影子当规则，必然在影子覆盖不到（钝点 A：跨语句）或影子误覆盖（钝点 B：定点读/写）的地方出错。

## 修复

- **钝点 A**：新增 `hasCaptureThenAssert(line, ctx)`——识别 `VAR=$(curl ...)` 捕获形态，在其后 K=5 条逻辑语句内查找对【同名】 `$VAR` 的 jq -e / grep -q / [ 比较 / case 值断言，找到即放行。evaluate 循环改传 `ctx={logicalLines,index}` 给 `rule.detect`，让跨语句规则拿得到后续上下文。变量名精确匹配防"捕获 A 断言 B"假放行；裸捕获后 K 行无断言仍命中（不放水）。
- **钝点 B**：抽出 `isAggregateDbProbeWithoutWindow(line)`，按断言意图分型——聚合（count/sum/avg/min/max）一律命中（即便带 WHERE，聚合读仍跨历史）；纯写语句（INSERT/UPDATE/DELETE，含 RETURNING）放行；非聚合 SELECT 中主键等值定点读（WHERE id/uuid/*_id 等值）放行，无主键等值的存在性探测保守命中（fail-closed），由作者用 gate-allow 兜底。

3 个生产实证 fixture（capture-then-assert / db-point-read / capture-no-assert）+ 单测，修复前命中/修复后放行（反例反之），既有 10 fixtures + 39 测试全绿不松动。

### 下次预防

- [ ] **规则按断言意图分型（值校验 / 时效防伪 / 失败传播），不要用句法特征当意图本身**。写规则前先问"这条断言想保证什么"，再问"什么句法形态会破坏这个保证"——而不是反过来拿某个句法当红线。
- [ ] 新增/细化行级规则时，先问"这条断言的 oracle 会不会跨语句/跨行"。会，就让规则吃 `ctx`（后续逻辑语句），别只盯单语句。
- [ ] 域规则（DB/文件/发布）落地前，列清"哪些形态真有被冒充/造假的风险"，只对有风险面的形态命中；确定行的读/写（主键等值、INSERT 写入）通常无风险面，默认放行。
- [ ] 边界拿不准一律 fail-closed（保守命中）+ gate-allow 逃生口兜底，宁可让作者显式豁免留痕，不要静默放水。
- [ ] 每次规则进化都用【生产实证合同】做 fixture（修复前命中、修复后放行）+ 反例 fixture（防放水），既有 fixtures/测试一个不许松动。
