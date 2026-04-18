# Learning: R7 — 补齐 Superpowers 1:1 最后 2 个 gap

## 背景

F3/F4/R2/R5 四波对齐 Superpowers 5.0.7 之后，严格审查仍有 2 处被 paraphrase：
- 01-spec.md autonomous 分支只保留"禁止问用户 A 还是 B"，丢掉了官方 `<HARD-GATE>` 原结构
- 02-code.md Root-Cause Tracing 只保留 4+1 步（observe/immediate/call-chain/trigger/fix），**漏了 Phase 2 Pattern Analysis**（Find Working Examples / Compare Against References / Identify Differences）

### 根本原因

1. F3/F4 当初补 Superpowers 纪律时，优先保留了"新增一段"增量思路，没有逐字对齐官方完整 Phase 划分
2. R2 之后才明确"能 copy 的官方原话必须逐字搬，不允许 paraphrase"的硬约束，但 F3 的落地早于这个约束，导致 4+1 步把官方 4 Phase 压扁成一个列表，Phase 2 整段被省略
3. autonomous 模式改造时，把 `user has approved it` 换成"禁止问用户"的行为禁令，丢掉了 HARD-GATE 本身的强制力标签（`<HARD-GATE>` 块）

### 下次预防

- [ ] 补 Superpowers 工件时，**第一步就做 diff 对照表**：官方原文每行 vs 我们版本每行，paraphrase/省略/软化各画一个差异点
- [ ] 修 paraphrase 问题用"逐字搬 + 顶部 source 注释 + 中文辅助译文"三件套，不改原文
- [ ] 唯一允许本地化的场景：autonomous 把 `user` 替换为 `Research Subagent`，必须明确标出"唯一本地化"
- [ ] 每次补完后跑自检命令：`grep -c 'HARD-GATE\|Pattern Analysis\|Working Examples' packages/engine/skills/dev/steps/*.md`，关键词全命中才算完成

## 本次修复

1. 01-spec.md autonomous section 0.2 后新增 `### 0.2.HARD-GATE` 子章节，内嵌官方 `<HARD-GATE>` 块原话 + 仅替换 `user has approved it` → `Research Subagent has confirmed it via Tier 1 approval`
2. 02-code.md `### Root-Cause Tracing` 从"4+1 步平铺"重构为 `Phase 1 / Phase 2 / Phase 3 / Phase 4` 分段：
   - Phase 1: Reproduce（原 step 1）
   - Phase 2: Pattern Analysis（新补，逐字搬 L122-150）
   - Phase 3: Hypothesis / 追原点（原 steps 2-4）
   - Phase 4: Fix + Defense-in-depth（原 step 5）
3. Engine 版本 bump 14.17.3 → 14.17.4，feature-registry.yml 加 changelog 记录两个 gap 的修复

## 影响

- Superpowers 1:1 复刻率从 14/17 → 15/17（加强牌仍为 4 条）
- Implementer 调试时拥有完整 4-Phase 方法论（R2 已补的 Stack Trace 插桩 + find-polluter 工件 + 本次 Pattern Analysis 共同组成完整调试流水线）
- autonomous /dev 的 Stage 1 开头有强制 HARD-GATE，禁止直接 write code before design approved
