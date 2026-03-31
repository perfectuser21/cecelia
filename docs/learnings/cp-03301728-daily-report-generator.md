# Learning: 自动日报生成器

**分支**: cp-03301728-998e739f-c183-48c3-8d2a-982734
**日期**: 2026-03-30

## 背景

实现每日 UTC 01:00 自动生成内容日报，写入 working_memory 并推送飞书。

### 根本原因

本次任务发现两个陷阱：
1. `manual:node -e` 命令如果只用 `accessSync` 而不加 `try/catch`，CI 的 check-dod-mapping.cjs 会认为它没有显式断言（虽然 accessSync 抛错会导致 exit 非0，但检查器无法静态分析）。
2. `manual:node -e` 命令中只有 `console.log()` 而无 `process.exit(1)` 会被 check-dod-mapping.cjs 识别为无断言测试（永远 exit 0），必须加 `try/catch { process.exit(1) }`。

### 下次预防

- [ ] DoD Test 字段中，所有 `accessSync` 调用必须包在 `try{ }catch(e){ process.exit(1) }` 中
- [ ] 禁止在 `manual:node -e` 中只用 `console.log()`，必须有 `process.exit(1)` 作为失败退出
- [ ] GATE 类型条目不要复用 ARTIFACT 的相同 Test 命令，语义不同

## 实现模式

- `notifier.js` 的 `sendFeishu()` 是飞书推送的唯一入口，不要重复实现
- `working_memory` 表通过 pool.query 直接操作（INSERT ... ON CONFLICT DO UPDATE）
- 幂等机制：写入触发记录 key（`daily_report_triggered_YYYY-MM-DD`），同天只执行一次
- tick.js 中新调度器用 `Promise.resolve().then(...).catch(e => console.warn(...))` 格式注册
