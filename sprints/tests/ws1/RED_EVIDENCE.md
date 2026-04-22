# Workstream 1 — Red Evidence (TDD Red 阶段, Round 2)

**执行时间**: 2026-04-22（Round 2 修订后）
**Vitest 版本**: 1.6.1
**命令**: `./node_modules/.bin/vitest run sprints/tests/ws1/ --reporter=verbose --no-coverage`

## 预期 Red 数

`it()` 块总数：**14**（Round 1 为 10；Round 2 新增 4 项）
- 3 iso：returns 200 / ignores query / within 5s
- 4 timezone：format（含严格 IANA 白名单正则）/ strict offset / fallback UTC / **Intl 正向读取（Round 2 新增，抓 mutation 8）**
- 3 unix：10-digit / within 5s / Number type
- **3 Content-Type（Round 2 新增，抓 mutation 10）**：/iso、/timezone、/unix 响应 `application/json`
- 1 router registration：3 routes registered

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

测试文件在 import 阶段就失败 —— `packages/brain/src/routes/time-endpoints.js` 模块不存在。这是 TDD Red 的标准形态：**所有 14 个 it() 都因模块加载失败而无法执行**，等价于 14 个失败。Generator 实现 WS1 后，模块就绪，14 个测试将逐一通过（Green）。

如果 Generator 写出"仅创建文件但 handler 行为错"的假实现，这 14 个 it() 中至少有以下断言会抓出来：
- ISO_RE 正则不匹配 → iso 3 个 it 失败（抓 mutation 1 / 4）
- offset 用 `+0800` 格式 → strict offset it 失败（抓 mutation 3）
- timezone 用 `Foo` / `X` 这类非 IANA 字符串 → 严格白名单正则 it 失败（抓 mutation 9）
- 硬编码返回 UTC 不透传 Intl 的 `Pacific/Auckland` → Intl 正向读取 it 失败（抓 mutation 8）
- unix 返回毫秒（13 位）→ 10-digit it 失败（抓 mutation 2）
- unix 返回字符串 → Number type it 失败（抓 mutation 5）
- handler 用 `res.send(JSON.stringify(...))` 绕开 `res.json()` → 3 个 Content-Type it 失败（抓 mutation 10）
- handler 不存在或 router 路径错 → router registration it 失败（抓 mutation 6）

## Red 校验通过

预期 ≥ 1 个 FAIL；实际 1 个 FAIL（覆盖 14 个 it）。✓
