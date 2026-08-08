contract_branch: cp-harness-propose-r1-0955c884-r935a5a8c-a4
sprint_dir: sprints/kernel-final-codex

# Contract DoD — Sprint: playground GET /kernel-ping 返回ok

合同批准版全文位于 `sprints/kernel-final-codex/contract-dod.md`。

- [x] [ARTIFACT] `playground/server.js` 含 `/kernel-ping` GET 路由，且不修改 Brain/Dashboard/Harness 文件
- [x] [ARTIFACT] 永久回归测试位于 `playground/tests/kernel-ping.test.js`，包含 Test Contract 四个覆盖名
- [x] [BEHAVIOR] [L2] B-01: GET `/kernel-ping` 返回 HTTP 200 [接缝×2]
- [x] [BEHAVIOR] [L2] B-02: 响应 body 严格为两个字节 `ok` [接缝×2]
- [x] [BEHAVIOR] [L2] B-03: 连续两次调用稳定返回 `ok` [接缝×2]
- [x] [BEHAVIOR] [L2] B-04: POST 保持 404 且既有 `/ping` 不回退 [接缝×2]

Red 证据：合同测试实际执行 4 条，3 failed / 1 passed，exit code 1；通过项仅验证合同要求保持不变的既有边界。
