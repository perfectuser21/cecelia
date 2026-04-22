# Workstream 1 — Red Evidence (TDD Red 阶段)

**执行时间**: 2026-04-22T11:21:49Z
**Vitest 版本**: 1.6.1
**命令**: `./node_modules/.bin/vitest run sprints/tests/ws1/ --reporter=verbose --no-coverage`

## 预期 Red 数

`it()` 块总数：**10**
- 3 iso：returns 200/ignores query/within 5s
- 3 timezone：format/strict offset/fallback UTC
- 3 unix：10-digit/within 5s/Number type
- 1 router：3 routes registered

## 实际 Red

```
FAIL  sprints/tests/ws1/time-endpoints.test.ts [ sprints/tests/ws1/time-endpoints.test.ts ]
Error: Failed to load url ../../../packages/brain/src/routes/time-endpoints.js
       (resolved id: ../../../packages/brain/src/routes/time-endpoints.js)
       in /workspace/sprints/tests/ws1/time-endpoints.test.ts. Does the file exist?

 Test Files  1 failed (1)
      Tests  no tests
```

## 解读

测试文件在 import 阶段就失败 —— `packages/brain/src/routes/time-endpoints.js` 模块不存在。这是 TDD Red 的标准形态：**所有 10 个 it() 都因模块加载失败而无法执行**，等价于 10 个失败。Generator 实现 WS1 后，模块就绪，10 个测试将逐一通过（Green）。

如果 Generator 写出"仅创建文件但 handler 行为错"的假实现，这 10 个 it() 中至少有以下断言会抓出来：
- ISO_RE 正则不匹配 → iso it 失败
- offset 用 `+0800` 格式 → strict offset it 失败
- unix 返回毫秒（13 位）→ 10-digit it 失败
- unix 返回字符串 → Number type it 失败
- handler 不存在或 router 路径错 → router registration it 失败

## Red 校验通过

预期 ≥ 1 个 FAIL；实际 1 个 FAIL（覆盖 10 个 it）。✓
