# Learning: Contract Gate curl-no-jq 误判 inline curl|grep-q 导致 dashboard 合同 GAN 空转

## 背景
harness 内部线第一条真 dashboard run（task 4fd93312）合同 GAN 反复 REVISION 不收敛、空转数小时。排查发现不是死等/传输/模型慢，是 Contract Gate 一条确定性规则反复打回。

## 根本原因
`packages/brain/src/lib/contract-gate.js` 的 `weak-oracle/curl-no-jq` 规则要求 curl 必须有值校验，放行三类 oracle：①inline `jq -e` ②状态码 oracle（`curl -w %{http_code}`）③capture-then-assert（`VAR=$(curl)` 后对 `$VAR` 做 grep -q/jq -e）。

**漏了第四类：inline 管道 `curl ... | grep -q '<字面量>'`**——这是验 HTML/纯文本响应（无法 jq）最自然的合法强 oracle。dashboard 合同必然用它（`curl 首页 | grep -q "页面文字"`），却被判弱断言 → REVISION 打回 → proposer 改不出 jq（HTML 不能 jq）→ GAN 收敛不了。

Gate 当年是给"验 JSON API 合同"设计的，没考虑"验 HTML 页面"场景；harness 内部线交付 dashboard（A 方案）后第一次撞出。

## 修法
contract-gate.js 加 `hasInlineGrepAssert(line)`：`curl` 且 `| grep -q[E]` 同一逻辑行 → 放行第四类。同义反复另由 `weak-oracle/tautology` 守，裸 curl 无断言仍命中（不放水）。永久 regression test：`contract-gate-inline-grep-oracle.test.js`。

## 下次预防
- 改/加 Contract Gate 规则时，必须同时覆盖三种响应类型的合法 oracle：JSON（jq -e）、HTTP 状态（%{http_code}）、HTML/文本（grep -q 内容）。别假设所有合同都验 JSON API。
- 新增"交付物类型"（dashboard/brain/API…）时，回头检查确定性 gate 是否对该类型的验证方式有合法 oracle 放行，否则 GAN 必空转。

## checklist
- [ ] Contract Gate 规则覆盖 JSON / 状态码 / HTML-文本 三类 oracle
- [ ] inline `curl | grep -q '<字面量>'` 放行（regression test 守死）
- [ ] 裸 curl 无断言仍命中（不放水，regression test 守死）
- [ ] 新交付物类型上线前，确认 gate 对其验证方式有合法 oracle
