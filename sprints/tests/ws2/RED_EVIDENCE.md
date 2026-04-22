# Workstream 2 — Red Evidence (TDD Red 阶段)

**执行时间**: 2026-04-22T11:21:49Z
**Vitest 版本**: 1.6.1
**命令**: `./node_modules/.bin/vitest run sprints/tests/ws2/ --reporter=verbose --no-coverage`

## 预期 Red 数

`it()` 块总数：**16**
- 6 validateIsoBody：accept Z、accept ±HH:MM、reject 缺字段、reject 缺毫秒、reject 缺时区、reject 非对象
- 5 validateTimezoneBody：accept 全合法、reject 缺 timezone、reject 缺 offset、reject HHMM、reject +8:00
- 5 validateUnixBody：accept 10 位、reject 13 位毫秒、reject 0/负、reject 字符串、reject 浮点

## 实际 Red

```
FAIL  sprints/tests/ws2/smoke-validators.test.ts [ sprints/tests/ws2/smoke-validators.test.ts ]
Error: Failed to load url ../../../packages/brain/test/time-endpoints.smoke.mjs
       (resolved id: ../../../packages/brain/test/time-endpoints.smoke.mjs)
       in /workspace/sprints/tests/ws2/smoke-validators.test.ts. Does the file exist?

 Test Files  1 failed (1)
      Tests  no tests
```

## 解读

测试文件在 import 阶段就失败 —— `packages/brain/test/time-endpoints.smoke.mjs` 文件不存在。所有 16 个 it() 因模块加载失败而无法执行，等价于 16 个失败。Generator 实现 WS2 后，3 个 validator 命名导出就绪，16 个测试将逐一通过。

如 Generator 写出"validator 永远返回 true"的假实现，所有 reject 类断言（共 11 条 reject 断言：iso 4 个、timezone 4 个、unix 5 个）将立刻 FAIL，把假实现挡住。

## Red 校验通过

预期 ≥ 1 个 FAIL；实际 1 个 FAIL（覆盖 16 个 it）。✓
