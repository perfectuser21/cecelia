# Learning: 封印文档不可变 × CI 延迟发现 = fix 死循环（第四层洋葱）

### 根本原因
- proposer SKILL 模板通篇 `sprints/.../` 省略号示例 → 照抄进 Test Contract 表；
- 封印链（GAN/审批/物化）没有校验表路径可解析；
- CI「Test Contract 覆盖检查」在 generator 产出后才红；
- fix 修 CI 的唯一路径 = 改 contract-draft.md，被 1.273.99 的文档不可变复核正确拦截
  （闸没错，CONTRACT IS LAW）→ 三次 provider_exit 同因死循环。

### 下次预防
- 「不可变产物」与「延迟校验」不能共存：凡是封印后不可改的文档，其全部机械可校验性质
  必须在封印时点校验完（同一把尺子提前，不新造规则——本修直接复用 CI 的解析链）。
- 给 LLM 的模板里不要放会被照抄的占位符形态（`...`/`…`/`xxx`），要么写死规则要么给真值。
- 新增不可变闸时列「谁在下游会需要改这个文件、为什么」清单——本病在 1.273.99 设计时
  若列过就会发现 CI 覆盖检查与合同表的耦合。

### 证据
- 容器一手日志 ~/cecelia-forensics/r33/cecelia-fleet-4e4a65b2*.log：fix 九项修复全绿后
  post-provider 复核 `frozen contract document diverged: .../contract-draft.md`
- r33 合同表原文：`sprints/.../tests/diff-gate-reason-passthrough.test.js`（字面省略号）
