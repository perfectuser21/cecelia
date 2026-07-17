# Contract DoD: headless-dispatch-smoke

Sprint: sprints/07172032-relay-d744a719
Task ID: d744a719-0247-4b15-b91d-882fae1838a5
Date: 2026-07-17

---

## [BEHAVIOR] 断言

[BEHAVIOR-1] POST /api/brain/tasks 携带 `mode=headless` 时，Brain API 返回 HTTP 200 或 201，且响应体含字符串类型的 `id` 字段。

[BEHAVIOR-2] POST /api/brain/tasks 携带 `mode=invalid`（任意非白名单值）时，Brain API 返回 HTTP 400，task-tasks.js 的 mode 白名单校验拒绝非法输入，不创建任务记录。

[BEHAVIOR-3] `packages/brain/src/docker-executor.js` 源码中存在 `CECELIA_HEADLESS: 'true'` 字面量，确保 headless 容器启动时环境变量注入有效。

[BEHAVIOR-4] `packages/brain/src/slot-allocator.js` 源码中存在 PPID 检测 + `CECELIA_HEADLESS=true` 逻辑，确保 macOS 下 slot 分配时能通过父进程参数识别 headless 模式。

[BEHAVIOR-5] `packages/brain/src/harness-skill-relay.js` 源码中存在 headless 路径与 `spawnFn`（docker）关联的代码/注释，确保 headless 模式下走 docker 派发而非 tmux。

[BEHAVIOR-6] `packages/quality/smoke-allowlist.txt` 文件中包含 `headless-dispatch-smoke.sh` 条目，棘轮闸已锁定，新脚本纳入 CI 守卫范围。

---

## manual:bash 验收命令

```bash
# === 前置：Brain API 在线检查 ===
curl -sf http://localhost:5221/healthz | python3 -c "import sys,json;d=json.load(sys.stdin);exit(0 if d.get('status')=='ok' else 1)"
echo "Brain healthz: $?"

# === BEHAVIOR-1：mode=headless 放行 ===
RESP=$(curl -sf -X POST http://localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"headless-dod-test","payload":{"orchestrator":"skill-relay","executor":"claude","mode":"headless","journey_id":"dod-test-001"}}')
echo "$RESP" | python3 -c "import sys,json;d=json.load(sys.stdin);exit(0 if isinstance(d.get('id'),str) else 1)"
echo "[BEHAVIOR-1] mode=headless → id 字段: $?"

# === BEHAVIOR-2：mode=invalid 拒绝 ===
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"invalid-mode-dod","payload":{"orchestrator":"skill-relay","executor":"claude","mode":"turbo"}}')
[ "$CODE" = "400" ] && echo "[BEHAVIOR-2] mode=invalid → 400: 0" || echo "[BEHAVIOR-2] mode=invalid → 400: 1 (got $CODE)"

# === BEHAVIOR-3：docker-executor.js CECELIA_HEADLESS 注入 ===
grep -q "CECELIA_HEADLESS: 'true'" packages/brain/src/docker-executor.js
echo "[BEHAVIOR-3] docker-executor CECELIA_HEADLESS 注入: $?"

# === BEHAVIOR-4：slot-allocator.js PPID 检测 ===
grep -qE "PPID|CECELIA_HEADLESS" packages/brain/src/slot-allocator.js
echo "[BEHAVIOR-4] slot-allocator PPID CECELIA_HEADLESS 检测: $?"

# === BEHAVIOR-5：harness-skill-relay.js headless→docker 路径 ===
grep -qE "headless|spawnFn|docker" packages/brain/src/harness-skill-relay.js
echo "[BEHAVIOR-5] harness-skill-relay headless/docker 路径: $?"

# === BEHAVIOR-6：allowlist 收录 ===
grep -q "headless-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt
echo "[BEHAVIOR-6] allowlist 收录: $?"

# === 完整 smoke 脚本运行 ===
bash packages/brain/scripts/smoke/headless-dispatch-smoke.sh
echo "smoke 脚本 exit: $?"
```

---

## DoD Checklist

- [ ] **FR1** `packages/brain/scripts/smoke/headless-dispatch-smoke.sh` 文件存在，权限含可执行位
- [ ] **FR2-a** smoke 脚本验证 `POST /api/brain/tasks(mode=headless)` → 200/201 + id 字段，测试通过
- [ ] **FR2-b** smoke 脚本验证 `POST /api/brain/tasks(mode=invalid)` → 400，测试通过
- [ ] **FR3** smoke 脚本验证 `docker-executor.js` 含 `CECELIA_HEADLESS: 'true'` 注入行，grep 命中
- [ ] **FR4** smoke 脚本验证 `slot-allocator.js` 含 PPID + CECELIA_HEADLESS 检测逻辑，grep 命中
- [ ] **FR5** smoke 脚本验证 `harness-skill-relay.js` 含 headless → docker spawnFn 路径，grep 命中
- [ ] **FR6** `headless-dispatch-smoke.sh` 已加入 `packages/quality/smoke-allowlist.txt`
- [ ] **NFR** 脚本无外部依赖（仅 curl + python3/node 内联 + Brain API），无需 docker 真实运行
- [ ] **NFR** 脚本单次运行时间 < 10s（code-inspection 步骤本地瞬时完成）
- [ ] **CI** 现有 brain-ci.yml smoke job glob `packages/brain/scripts/smoke/*.sh` 已覆盖新脚本
- [ ] **不变量** 未修改任何既有 smoke 脚本逻辑，仅新增文件
- [ ] **不变量** 现有 brain-ci、engine-ci 无新失败（CI 全绿）
- [ ] **BEHAVIOR-1** POST mode=headless → 200/201 + id 断言已验证
- [ ] **BEHAVIOR-2** POST mode=invalid → 400 断言已验证
- [ ] **BEHAVIOR-3** docker-executor CECELIA_HEADLESS 注入断言已验证
- [ ] **BEHAVIOR-4** slot-allocator PPID 检测断言已验证
- [ ] **BEHAVIOR-5** harness-skill-relay headless→docker 路径断言已验证
- [ ] **BEHAVIOR-6** allowlist 棘轮闸锁定断言已验证
