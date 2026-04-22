# Workstream 1 — Red Evidence (TDD Red 阶段, Round 3)

**执行时间**: 2026-04-22（Round 3 修订后）
**Vitest 版本**: 1.6.1
**命令**: `npx vitest run sprints/tests/ws1/ --reporter=verbose`

## 预期 Red 数

`it()` 块总数：**16**（Round 1 为 10；Round 2 增至 14；Round 3 再 +2 反制新 mutation 11、12）

- 3 iso：returns 200 / ignores query / within 5s
- 6 timezone：format（严格 IANA 白名单正则）/ strict offset / fallback UTC / Intl 正向读取（抓 mutation 8）/ **timezone↔offset 联合一致 Asia/Kolkata→+05:30（Round 3，抓 mutation 11）** / **handler 每次请求内部调 Intl、非模块级缓存（Round 3，抓 mutation 12）**
- 3 unix：10-digit / within 5s / Number type
- 3 Content-Type（Round 2 提出，Round 3 mockRes 语义锁死）：/iso、/timezone、/unix 响应 `application/json`。mockRes 新增 `.send()` 只写 body 不写 header，`.setHeader()` 显式写 header，由此锁死"只有 `.json()` 或 `.set('content-type', ...)` 能让 header 断言通过"
- 1 router registration：3 routes registered

## 实际 Red（round 3 本地运行）

```
FAIL  sprints/tests/ws1/time-endpoints.test.ts [ sprints/tests/ws1/time-endpoints.test.ts ]
Error: Failed to load url ../../../packages/brain/src/routes/time-endpoints.js
       (resolved id: ../../../packages/brain/src/routes/time-endpoints.js)
       in /workspace/sprints/tests/ws1/time-endpoints.test.ts. Does the file exist?

 Test Files  1 failed (1)
      Tests  no tests
```

## 解读

测试文件在 import 阶段就失败 —— `packages/brain/src/routes/time-endpoints.js` 模块不存在。这是 TDD Red 的标准形态：**所有 16 个 it() 都因模块加载失败而无法执行**，等价于 16 个失败。Generator 实现 WS1 后，模块就绪，16 个测试将逐一通过（Green）。

如果 Generator 写出"仅创建文件但 handler 行为错"的假实现，这 16 个 it() 中至少有以下断言会抓出来：

- ISO_RE 正则不匹配 → iso 3 个 it 失败（抓 mutation 1 / 4）
- offset 用 `+0800` 格式 → strict offset it 失败（抓 mutation 3）
- timezone 用 `Foo` / `X` 这类非 IANA 字符串 → 严格白名单正则 it 失败（抓 mutation 9）
- 硬编码返回 UTC 不透传 Intl 的 `Pacific/Auckland` → Intl 正向读取 it 失败（抓 mutation 8）
- **timezone 透传但 offset 走独立分支硬返 `+08:00` → Asia/Kolkata 联合一致 it 失败（抓 mutation 11，Round 3）**
- **handler 在模块加载时 `const TZ = Intl...` 固化 → 连续两次 stub Intl 返回值相同 → 非模块级缓存 it 失败（抓 mutation 12，Round 3）**
- unix 返回毫秒（13 位）→ 10-digit it 失败（抓 mutation 2）
- unix 返回字符串 → Number type it 失败（抓 mutation 5）
- handler 用 `res.send(JSON.stringify(...))` 绕开 `res.json()` → mockRes.send 不写 content-type → 3 个 Content-Type it 失败（抓 mutation 10，Round 3 mockRes 语义锁死）
- handler 不存在或 router 路径错 → router registration it 失败（抓 mutation 6）

## Red 校验通过

预期 ≥ 1 个 FAIL；实际 1 个 FAIL（覆盖 16 个 it）。✓
