# PROBE_FAIL_EVOLUTION scanner_stale 根因与修复

**日期**: 2026-06-28  
**Brain 版本**: 1.232.1  
**PR**: evolution-scanner 单 PR 异常不阻断 gate 写入

## 根因

`evolution-scanner.js` 的 per-PR 处理循环中，去重 `SELECT` 和 `INSERT INTO component_evolutions` 在外层 try/catch 之外。若 DB 报错（如 `source_repo` 列缺失），整个 for 循环 throw 跳出，末尾的 `evolution_last_scan_date` 门控写入永远不执行。

下次 tick 重试时，门控日期未更新，再次进入循环，再次失败——形成死循环。`working_memory.evolution_last_scan_date.date` 停在首次失败那天，探针报 `scanner_stale`。

## 修复

将整个 per-PR 处理块（去重查询 + 文件获取 + INSERT）包裹在一个 `try/catch` 内：

```js
for (const pr of mergedPRs) {
  try {
    const { rowCount } = await pool.query('SELECT 1 FROM component_evolutions ...');
    // ... 文件获取 + INSERT
  } catch (e) {
    console.warn(`[evolution-scanner] PR #${pr.number} 处理失败，跳过:`, e.message);
    skipped++;
  }
}
// 无论上面循环成功/失败，gate 都在这里写入
await pool.query(`INSERT INTO working_memory ... ON CONFLICT DO UPDATE ...`);
```

## 验收证据

- 回归测试「去重查询 DB 抛异常时仍更新门控」通过
- 回归测试「INSERT 抛异常时仍更新门控」通过
- evolution-scanner 全部 63 个测试通过
- capability-probe-evolution 全部 15 个测试通过

## 教训

**结构性原则**：任何带"最终必须执行的清理/门控写入"的循环，清理步骤必须在循环之外（finally 或循环后），不能依赖循环体未抛异常。try/catch 只保护局部，不保护整体流程。
