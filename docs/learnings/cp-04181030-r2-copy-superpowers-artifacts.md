# Learning — R2: 直接 copy Superpowers 原生工件

## 背景
F3 (PR #2382) 和 F4 (PR #2386) 对齐 Superpowers 5.0.7 时，agent prompt 写的是"补
Superpowers 缺口"，被理解成"写中文化等价概念"而非"原样搬运官方工件"。结果二方验证
戳穿 5 个仍然缺失的具体工件：find-polluter.sh、condition-based-waiting
实现代码、Common Failures 表、Rationalization Prevention 表、Stack Trace 插桩示例。

## 根本原因
Prompt 语义模糊导致"补缺口"被扩大解释为"重写"。官方开源仓库里有原文的内容，
agent 认为"我能用中文更简洁说"，于是丢失教学表、丢失脚本、丢失 TypeScript 实现，
只保留了"概念描述"。

具体三类偏离：
1. 工具脚本缺失——只说"用 bisection 找污染"，没搬 63 行 bash。
2. 实现代码缺失——只说"用 waitFor 代替 setTimeout"，没提供 import 目标。
3. 教学表缺失——官方 8 行 markdown 表格被改写成散文描述。

## 下次预防
- [ ] 遇到"对齐官方 X"任务，PRD 必须列出具体原文 path + 行号 + 行数，
      agent 对比 `wc -l` 偏差 > 10% 就算作 gap。
- [ ] "copy"不等于"paraphrase"——prompt 必须明文写"逐字搬运"并禁止重写。
- [ ] 所有复制工件顶部必须有 4 行 source 注释（Original path / Adaptation /
      sync record 链接），便于未来 Superpowers 版本升级时快速 diff。
- [ ] Explore agent 做二方验证时优先跑 `wc -l` / `grep -c` 对比官方原文，
      不能只看"有没有提到这个概念"。
- [ ] 本地化改动范围严格限制：中文翻译 + test runner 差异（npm test → npx vitest run），
      其余一个字不动。

## 本次交付
- `packages/engine/scripts/find-polluter.sh` — 67 行（63 官方 + 4 header）
- `packages/brain/src/utils/condition-based-waiting.ts` — 220 行
  （158 官方 verbatim + 10 type shim + 52 generic waitFor helper）
- `packages/brain/src/__tests__/condition-based-waiting.test.ts` — 4 case
- `packages/engine/skills/dev/steps/02-code.md` — 追加 Common Failures / Rationalization
  Prevention / Stack Trace 插桩三个官方教学段落，保留英文原文。
- Engine 14.17.0 → 14.17.2（patch bump，无新逻辑，只补工件）
- feature-registry.yml 14.17.2 changelog 引用 4 个 copy 源
