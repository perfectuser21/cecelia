# Contract DoD: headless-cancel-smoke [98b4c159]

## 判定点（BEHAVIOR Gates）

- [BEHAVIOR] B1: smoke 脚本文件存在（packages/brain/scripts/smoke/headless-cancel-smoke.sh）
- [BEHAVIOR] B2: 脚本行数 < 60（wc -l 校验，NFR-01 合规）
- [BEHAVIOR] B3: 脚本不含禁止依赖 jq（grep 检查，NFR-02 合规）
- [BEHAVIOR] B4: 脚本含 PATCH status=cancelled 清理路径
- [BEHAVIOR] B5: headless-cancel-smoke.sh 已登记进 packages/quality/smoke-allowlist.txt（I-02 合规）
- [BEHAVIOR] B6: 脚本含固定探针 title headless-cancel-probe-test（NFR-03 可重入）
- [BEHAVIOR] B7: Brain 可达时脚本端到端运行成功（exit 0）；Brain 不可达时脚本以非零退出码退出（sad path）

## 验收断言（DoD Checklist）

- [ ] A1: POST /api/brain/tasks(mode=headless, executor=claude, orchestrator=skill-relay) → HTTP 200/201，响应 JSON 含 id 字段（非空）
- [ ] A2: GET /api/brain/tasks/{id} → 响应 payload.mode == "headless"
- [ ] A3: PATCH /api/brain/tasks/{id} body={"status":"cancelled"} → HTTP 200
- [ ] A4: GET /api/brain/tasks/{id} → 响应 status == "cancelled"（状态固化）
- [ ] A5: 第二次 POST /api/brain/tasks(title="headless-cancel-probe-test") → HTTP 200/201（可重入性验证）

## 验收命令

manual:bash: cd /workspace && bash packages/brain/scripts/smoke/headless-cancel-smoke.sh

## 铁律（不可绕过）

1. 脚本行数 < 60（wc -l 校验，超出即 CI 红）
2. 依赖只允许 bash + curl + python3，禁止 jq / psql / node
3. 探针 title 固定为 "headless-cancel-probe-test"（保证可重入，PATCH cancelled 后可重复运行）
4. 登记 packages/quality/smoke-allowlist.txt（I-02：棘轮不允许新增 smoke debt）
5. 脚本路径：packages/brain/scripts/smoke/headless-cancel-smoke.sh
6. 路由约束：executor=claude + mode=headless，不得触发真实 agent 调度（I-01）
