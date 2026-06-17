# Learning — Contract Gate `cheat/or-true` 误伤负向测试（预期失败）惯用法

- 分支：cp-06120138-gate-or-true-negative
- 日期：2026-06-12
- 关联：#3348（Contract Gate 引入）、生产 run d8acba51（ci-defense 合同，GAN 振荡到 round 5）

### 根本原因

确定性规则 `cheat/or-true` 用最朴素的 `/\|\| *true/` 判定"吞错"，把 shell 的负向测试惯用法
`cmd && { echo "FAIL"; exit 1; } || true` 一并误伤。该结构语义是"cmd **预期失败**；若反而成功
就进块内主动 `exit N` 报 FAIL"，末尾 `|| true` 承接的是 cmd 的**预期失败**退出码（set -e 下避免
预期失败直接杀脚本），不是吞掉真实断言。规则给的修复建议"删除 || true"照做会直接破坏负向测试。

更深一层：ci-defense / fail-closed 类合同的职责**就是**验证"某命令应失败"，负向测试不可避免。
规则没区分"吞掉应成功命令的失败"（作弊）与"承接应失败命令的预期失败"（合法）→ proposer 无论怎么
改都收敛不了 → GAN 无限振荡。**确定性规则上线首日必然撞上语言方言**，这是规则进化的常态。

### 修复

1. 新增 `isNegativeFailAssertion(line)`：识别单行 `&& { …; exit N|return N; } || true`（N≠0，含
   `exit "$N"` / 多语句块变体）→ 判为负向测试惯用法，`cheat/or-true` 放行。
2. 保守 fail-closed：多行 `{}`（块跨行）等行级匹配识别不到的复杂变体仍命中，由作者用 gate-allow 豁免留痕。
3. `exit 0` 不算负向断言（那是兜底）；裸 `assert || true` / `grep xxx || true`（无前置 `&& {…exit N}`）
   仍命中——既有 6 类作弊 fixtures 一个不松动。
4. 顺手改文案：or-true 建议加"改写为 `if cmd; then echo FAIL; exit 1; fi` 或 gate-allow 豁免留痕"；
   file-existence-only 建议补 `grep -q '<关键内容>' file` 升级示例。

### 下次预防

- [ ] 确定性规则上线先在历史真实合同语料上回放，提前发现方言（不要只用人造 fixture）。
- [ ] 规则进化必须带**不弱化既有 fixtures** 的回归断言（新增放行样例 + 既有命中样例双向锁定）。
- [ ] 任何"删掉 X"类修复建议，先确认 X 不是某合法惯用法的必要部分；覆盖不了就保守命中 + 提供 gate-allow 逃生口，别一刀切。
