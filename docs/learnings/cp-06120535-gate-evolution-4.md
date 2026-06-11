# Learning — Contract Gate 规则进化 R4（注释行不参与作弊扫描 + capture-negative-assert 放行）

分支：cp-06120535-gate-evolution-4
日期：2026-06-12
关联：#3348 / #3350 / #3351 / #3353 / #3357（同一条 Contract Gate 规则进化线）

## 背景

`#3357` 把 capture-then-assert 跨语句 oracle 接入 curl-no-jq 后，生产 run da418741（ci-defense-r2 合同）又实证两个钝点，致正确合同被 cheat/or-true 误报、GAN 烧轮次：

- **缺陷 A**：`# 必须非零退出（上面 || true 是因为要捕获 log；用 echo 验返回）` 是一行纯注释（首个非空白字符为 `#`），里面写了 `|| true` 字样，被 cheat/or-true 当成验收脚本命中。
- **缺陷 B**：`TAMPER_LOG=$(... npx vitest run ... 2>&1 || true)` 把【预期失败】命令的输出捕获进变量，`|| true` 落在命令替换 `$( )` 内部，随后 `echo "$TAMPER_LOG" | grep -q "FAIL.*env_missing"` 对同名变量断言——与 #3351 单语句负向断言同语义，却被误报。

### 根本原因

**扫描器在"看懂内容是什么"之前就开始套规则。**

- 缺陷 A：规则直接对【逻辑语句文本】跑 regex，却没区分这段文本是"验收脚本"还是"写给人看的注释"。注释里随便提一句 `|| true`/`MOCK_X`/`test -f` 就被当红线——这不是规则方言问题，是扫描器漏了【词法分层】这一步：注释和字符串字面量是源码里"不可执行的料"，套语义规则前必须先把它们剥掉。
- 缺陷 B：和 #3351/#3353/#3357 同根——规则把"句法特征（`|| true` 出现）"当成了"吞错意图"本身。但 `VAR=$(预期失败命令 || true)` 里的 `|| true` 承接的是【命令替换内部预期失败】，输出已被捕获、下一句还要对它断言——这是合法的捕获形态负向测试，和单语句 `cmd && {...} || true`（#3351）只是承接位置不同。

## 修复

- **缺陷 A**：新增 `isCommentLine(line)`（行首 `#`，含前导空白），evaluate 循环里在 gate-allow 跳过之后增加一条"纯注释行 continue"——纯注释逻辑语句不跑任何 cheat/weak-oracle/env 规则。保守只做【行首 `#`】跳过：行尾注释段的剥离涉及 heredoc / 字符串内 `#` 的边界（`grep '#tag'`、URL fragment `http://x#y`），拿捏不准宁可不剥，避免把真命令尾部误判成注释而放水（单测固化：`assert_output || true  # tail` 仍命中）。
- **缺陷 B**：新增 `isCaptureNegativeThenAssert(line, ctx)`，三重收口防放水——(1) 必须是 `VAR=$(...)` 捕获形态（`captureSubstitutionSpan` 用括号深度扫描取命令替换内部）；(2) `|| true` 必须落在命令替换【内部】（赋值之外另起的 `foo || true` swallow 不放行）；(3) 复用 #3357 的 `hasCaptureThenAssert`，要求后续 K=5 条逻辑语句内对【同名】 $VAR 有 grep -q / jq -e / [ 比较 / case 值断言。裸捕获后无断言、裸 `cmd || true`、断言无关变量 → 仍命中。cheat/or-true 的 detect 改收 ctx。

2 个生产实证 fixture（comment-or-true / capture-negative-assert）+ 单测，修复前命中/修复后放行；反例（裸 cmd||true 无捕获、捕获后无断言、捕获外 swallow、断言无关变量、真命令尾 # 段）仍命中。既有 13 fixtures + 全部单测（54→63）全绿不松动；wiring/converge 测试绿。

### 下次预防

- [ ] **扫描器的第一课：先剥离注释与字面量，再谈规则**。任何对源码/脚本文本跑 regex 规则的扫描器，第一步必须做词法分层——把注释、字符串字面量这些"不可执行的料"剥掉，再对剩下的真命令套语义规则。跳过这一步，注释里随手一句关键词就会触发误报。
- [ ] 词法剥离要分清"安全剥"和"危险剥"：行首注释（首个非空白为 `#`）安全剥；行尾注释段涉及 heredoc/字符串内 `#` 的边界，拿不准就别剥，宁可漏放一点也别误把真命令当注释放水。
- [ ] 负向测试（预期失败）有多种承接形态：单语句块 `cmd && {...} || true`、捕获形态 `VAR=$(cmd || true)` + 跨语句断言。识别一种不等于识别全部，每遇到新生产形态就补一条放行 + 配套反例，别把"我只见过这一种"当成"只有这一种"。
- [ ] 放行规则一律三重收口（形态匹配 + 位置约束 + 后续断言存在）+ 变量名精确匹配，确保"放行"不等于"放水"；边界拿不准 fail-closed + gate-allow 逃生口兜底。
- [ ] 每次规则进化都用【生产实证合同】做 fixture（修复前命中、修复后放行）+ 反例 fixture（防放水），既有 fixtures/测试一个不许松动。
