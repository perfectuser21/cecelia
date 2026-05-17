# Learning — muted toggle 测试补强

分支：cp-0422094645-muted-test-coverage
日期：2026-04-22
Task：3c359029-059a-4b3a-b858-e7ddbad23da4

## 背景

Alex 问："这两个开关有没有写进 E2E test？有没有进 CI？别他妈到时候又坏了。"

实况盘点后发现两个缺口：
- LiveMonitor 的 muted toggle（#2511 加的）**无测试**
- 无真 pg + 真 HTTP 的 muted E2E（所有测试都 mock fetch / mock pool）

## 本次解法

### A. LiveMonitor 静态 grep 测试
不渲染整页（1700+ 行 mock 成本高）。fs.readFileSync + regex 检查 5 个
关键锚点（GET / PATCH / env_override disabled / 文案 / body）。
薄防线，挡"代码被删"不挡"逻辑错"。深度验证由其他层覆盖。

注意：源码文案是 JSX 三元表达式 `飞书: {muted.enabled ? '静默中' : '发送中'}`，
不是字符串字面量，测试断言须分开检查 `飞书:`、`静默中`、`发送中`。

### B. muted HTTP E2E integration test
照抄 consciousness-toggle-e2e.integration.test.js 改名 muted 版。
supertest 真起 Express + 真 pg pool + 真跑 migration 242。
验证 GET → PATCH → GET → DB 持久化 + cache write-through + toggle 对称。

### 复用而非复造
consciousness-toggle-e2e 已跑在 brain-integration CI job 绿，直接照抄
改名是最快路径。

## 根本原因

每次新增"用户可操作开关"后没有标准检查单，导致 LiveMonitor muted toggle
在 PR #2511 合并时漏掉了所有测试层（unit guard 有，但 HTTP 级和 UI 源码
锚点均无）。

## 下次预防

- [ ] 每个"用户可操作开关"必须有三层测试：unit（guard）+ 组件（UI）+
      integration（真 HTTP）。缺哪层哪层都可能漏
- [ ] 1000+ 行大组件加新交互时，先考虑提取子组件（方便单测）；不提取
      至少做 grep 级锚点回归
- [ ] 新开关复用现成模板（consciousness-guard + consciousness-toggle-e2e），
      不要从零写
- [ ] grep 级 UI 测试断言 JSX 表达式时，分拆成多个 toContain 而非一行
      字符串字面量（因为 JSX 不是纯字符串）

## 关键 PR

- 本 PR（待合并）: muted 测试补强
- 前置: #2511（runtime BRAIN_MUTED + LiveMonitor UI）/ #2513（SettingsPage）
