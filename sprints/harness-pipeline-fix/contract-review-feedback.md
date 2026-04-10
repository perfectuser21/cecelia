# Contract Review Feedback (Round 1)

## 必须修改项

### 1. [命令错误] Feature 3 — contract_branch null guard 的 `[P0]` 检查切片方向错误

**问题**: 验证命令在 `contract_branch=null` 位置向后切 200 字符检查 `[P0]`，但实际代码中 `[P0]` 出现在 `contract_branch=null` **之前**（同一行格式：`[P0][execution-callback] ... contract_branch=null`）。`src.slice(guardIdx, guardIdx + 200)` 永远看不到前面的 `[P0]`。

**影响**: 此命令在 main 当前代码上**直接 FAIL（exit code 1）**，Evaluator 执行时会误判为"P0 guard 不存在"。正确实现反而无法通过验证。

**建议**: 将切片窗口改为向前+向后覆盖，例如：
```javascript
const region = src.slice(Math.max(0, guardIdx - 200), guardIdx + 200);
```
或者直接搜索 `!contractBranch` guard 块（而非搜索 console.error 中的字符串），然后分别验证 `[P0]` 和 `return`：
```javascript
const guardIdx = src.indexOf('!contractBranch');
if (guardIdx < 0) { console.log('FAIL'); process.exit(1); }
const region = src.slice(guardIdx, guardIdx + 400);
if (!region.includes('[P0]')) { console.log('FAIL: guard 缺少 P0 标记'); process.exit(1); }
if (!region.includes('return')) { console.log('FAIL: guard 缺少 return'); process.exit(1); }
```

**DoD Test 字段也需同步修改**（当前 DoD 中 Feature 3 的 Test 命令同样会 FAIL）。

## 可选改进

### 2. [边界命令弱] Feature 5 — 幂等保护边界检查命中错误上下文

**问题**: `src.indexOf('already queued')` 首次命中在 architecture_design 上下文（约第 1261 行），而非 harness WS 幂等上下文（约第 2008 行）。检查碰巧通过，但验证的不是 harness 特定的幂等逻辑。

**建议**: 使用更精确的 harness 特定字符串，如 `src.indexOf('WS${nextWsIdx} already queued')` 或搜索包含 `workstream_index` 的 `already queued` 行。
