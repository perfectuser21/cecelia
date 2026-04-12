---
branch: cp-0411211621-e50eece2-efc3-4bb2-8760-9495b7
created: 2026-04-12
task: Engine CI KR5 — CI 绿灯率诊断 + 修复
---

# Learning: CI 绿灯率诊断 — harness-pipeline.test.ts 窗口脆弱性

## 诊断结论

分析近 94 次 CI 运行（75 成功 / 8 失败 / 11 取消），绿灯率 79%（排除 cancel 90.4%）。

8 次失败根因分类：

| 分类 | 次数 | 是否系统性 |
|------|------|-----------|
| `harness-pipeline.test.ts` 2000-char 窗口太小 | 5 | ✅ 系统性，本 PR 修复 |
| engine `.hook-core-version` 版本不同步 | 1 | ⚠️ 操作失误，CI 已能检测 |
| registry-lint 4 errors | 1 | ⚠️ 分支特定，main 已修复 |
| SyntaxError: Identifier 'steps' already declared | 1 (73 个测试) | ⚠️ 代码 bug，main 已修复 |

### 根本原因（最主要）

`harness-pipeline.test.ts` 第 43 行：

```js
const region = execSrc.slice(idx, idx + 2000);
```

用 2000 字符窗口检查 `harness_report` 是否在 `currentWsIdx === totalWsCount` marker 之后。

实际情况：
- 当前 marker → `harness_report` 的距离：**1764 chars**
- 当前 `if` 块的总长度：**2515 chars**
- 窗口大小：2000 chars

当 PR 在 marker 和 `harness_report` 之间新增代码（如 CI 检查逻辑，约 500+ chars），距离超过 2000，测试失败。这是**测试窗口不够宽松**导致的系统性脆弱。

## 修复方案

窗口从 2000 → 4000，为未来代码扩展预留 1485 chars 余量（基于当前块长度 2515 + 1485 = 4000）。

### 下次预防

- [ ] 写 source-pattern 类型测试（通过 indexOf 检查代码结构）时，窗口要比实际块大 2x
- [ ] 若 `if` 块长度 > 3000，改用 indexOf 语义检查（不限窗口距离），而不是 slice
- [ ] engine 版本 bump 必须同时更新 6 个文件：package.json / package-lock.json / VERSION / .hook-core-version / hooks/VERSION / regression-contract.yaml

## 预期效果

修复 5/8 系统性失败源，预期绿灯率从 90.4% → 96.4%（达到 KR5 ≥95% 目标）。
