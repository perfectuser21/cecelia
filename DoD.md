contract_branch: cp-harness-propose-r3-84249dfd
workstream_index: 1
sprint_dir: sprints

# Contract DoD — Workstream 1: GET /echo 端点实现

**范围**: `playground/server.js` 新增 GET /echo 路由，读取 `msg` query 参数原样回显；`playground/tests/echo.test.js` vitest 单元测试
**大小**: S（< 100 行净增，≤ 2 文件）

## ARTIFACT 条目

- [ARTIFACT] `playground/server.js` 内含 `/echo` 路由注册
- [ARTIFACT] `playground/tests/echo.test.js` 文件存在
- [ARTIFACT] TDD Red 阶段验证 — `playground/.ws1-red.log` 存在且含 FAIL 证据

## BEHAVIOR 条目

- [BEHAVIOR] GET /echo?msg=hello → 200 + {echo: "hello"}
- [BEHAVIOR] response keys 严格等于 ["echo"]
- [BEHAVIOR] 禁用 key 不存在: message/result/response/data/output/text/reply/body/msg
- [BEHAVIOR] GET /echo?msg= → 200 + {echo: ""}
