# DoD 列表 — 07171830-xian-harness-lane

> TASK_ID：7750cd32-d73b-4a53-91cf-8fd171bf358b  
> 合同版本：v1.0（2026-07-17）

---

[BEHAVIOR] BEHAVIOR-1：getTaskLocation 动态 location 覆盖
**描述**：当传入对象 `{ task_type: 'harness_initiative', location: 'xian' }` 时，`getTaskLocation` 返回 `'xian'`，不再硬编码返回 `'us'`。  
**回归**：`task-router-xian-harness.test.js` 全绿  
**向后兼容**：`getTaskLocation('harness_initiative')` 字符串调用仍返回 `'us'`（零回归）

[BEHAVIOR] BEHAVIOR-2：xian 分支白名单门禁
**描述**：`spawnSkillRelaySession` 收到 `task.location='xian'` 但 `task.payload.allow_xian !== true` 时，必须返回 `{ ok: false, error: /allow_xian/ }`，并将 task 回滚为 `queued`，不调用 `spawnCodexBridgeDetached`。  
**回归**：`harness-skill-relay-xian.test.js` → `allow_xian 缺失` 用例通过

[BEHAVIOR] BEHAVIOR-3：xian 分支调 bridge 不调 docker
**描述**：`task.location='xian'` + `payload.allow_xian=true` 时，`spawnSkillRelaySession` 调用 `spawnCodexBridgeDetached('http://100.86.57.69:3458/run', ...)` 而不是 `spawnDockerDetached`；bridge payload 含 `task_type='harness_relay'` 且 `brain_url` 来自 process.env.XIAN_BRAIN_URL（默认 'http://100.86.57.69:5221'）（非 host.docker.internal）。  
**回归**：`harness-skill-relay-xian.test.js` → `xian 派发路径` 用例通过；断言改为 `expect(url).toMatch(/5221/)` 或 `expect.stringContaining('5221')`，不锁定具体 IP

[BEHAVIOR] BEHAVIOR-4：xian spawn 落 initiative_runs `orchestrator_host=skill-relay-xian`
**描述**：xian bridge spawn 成功后，`initiative_runs` 表插入一行，`orchestrator_host='skill-relay-xian'`，`phase='A_planning'`，`deadline_at = NOW() + 8h`。watchdog 和并发上限逻辑可感知此行（INV-6）。  
**回归**：`harness-skill-relay-xian.test.js` → mock DB 断言 INSERT 参数含 `'skill-relay-xian'`

[BEHAVIOR] BEHAVIOR-5：/health 返回 docker_available 字段
**描述**：`codex-bridge.cjs` GET `/health` 响应体含 `docker_available: boolean`。`docker info` 可用时为 `true`，不可用时为 `false`（不影响 HTTP 200 主体）。  
**回归**：smoke 验收命令（manual:bash，见下）

[BEHAVIOR] BEHAVIOR-6：bridge spawn 失败时 loud 失败 + task 回滚
**描述**：`spawnCodexBridgeDetached` 抛异常（bridge 不通/HTTP 500）时，`_spawnXianBridgeSession` 将 task 回滚为 `queued`，返回 `{ ok: false, error: <msg> }`，不静默降级到 US docker 路径（INV-2 + NFR-2）。  
**回归**：`harness-skill-relay-xian.test.js` → `bridge 失败回滚` 用例通过

[BEHAVIOR] BEHAVIOR-7：禁止 HARNESS_XIAN_ENABLED / HARNESS_XIAN_BRIDGE_URL 字面量
**描述**：所有新增代码中不含 `HARNESS_XIAN_ENABLED` / `HARNESS_XIAN_BRIDGE_URL` 字面量。xian 路径完全由 `task.location` DB 字段驱动（INV-4）。  
**回归**：现有 `executor-xian-env-passthrough.test.js` + smoke `harness-xian-spawn-smoke.sh` 仍全绿

[BEHAVIOR] BEHAVIOR-8：dispatcher xianBypass 对 location=xian 的 harness_initiative 生效
- Criteria: dispatcher.js 的 xianBypass 检查改为包含 `task.location === 'xian'` 直接判断（或等价方式），使 location=xian 的 harness_initiative 任务不受 task_pool 限制拦截
- 实现要求: dispatcher.js peek task 完整对象时检查 task.location === 'xian'，而非依赖 getTaskLocation(nextType: string)
- Test: vitest unit（dispatcher-xian-harness-bypass.test.js）—— mock task.location='xian' task_type='harness_initiative'，池满时任务仍被 dispatch，不被 dispatchAllowed=false 拦截

---

## [ARTIFACT] 产出物清单

| ID | 产出物 | 路径 | 说明 |
|----|--------|------|------|
| ART-1 | failing test E1 | `packages/brain/src/__tests__/task-router-xian-harness.test.js` | 须先 RED commit，再绿 |
| ART-2 | failing test E2 | `packages/brain/src/__tests__/harness-skill-relay-xian.test.js` | 须先 RED commit，再绿 |
| ART-3 | task-router.js 改动 | `packages/brain/src/task-router.js` | getTaskLocation 重载支持对象入参 |
| ART-4 | harness-skill-relay.js 改动 | `packages/brain/src/harness-skill-relay.js` | 新增 xian 分支 + `_spawnXianBridgeSession` |
| ART-5 | codex-bridge.cjs 改动 | xian-M4 宿主（与 repo 同步） | /health docker_available + /run harness_relay |
| ART-6 | smoke 脚本 | `scripts/harness-xian-relay-smoke.sh` | 静态验证 _spawnXianBridgeSession + skill-relay-xian 字面量存在；mock bridge POST |
| ART-7 | 合同文档 | `sprints/07171830-xian-harness-lane/contract-draft.md` | 本次产出 |
| ART-8 | DoD 文档 | `sprints/07171830-xian-harness-lane/contract-dod.md` | 本次产出 |
| ART-9 | dispatcher.js 改动 | `packages/brain/src/dispatcher.js` | xianBypass 增加 task.location === 'xian' 直接判断 |
| ART-10 | dispatcher-xian-harness-bypass.test.js | `packages/brain/src/__tests__/dispatcher-xian-harness-bypass.test.js` | BEHAVIOR-8 单元测试 |
| ART-11 | codex-bridge.cjs BEHAVIOR-5 单元测试 | `packages/brain/src/__tests__/codex-bridge-health.test.js` | mock execSync → docker_available true/false |

---

## [SEQUENCE] 强制执行顺序

```
Step 0：探测环境
  └─ curl http://100.86.57.69:3458/health → 确认 docker_available 状态

Step 1：failing test 先行（INV-5）
  └─ 写 ART-1 + ART-2，运行确认 RED
  └─ git commit（RED commit，message 含 [RED]）

Step 2：改动 C（task-router）
  └─ ART-3，运行 ART-1 → 由 RED → GREEN

Step 3：改动 B（harness-skill-relay）
  └─ ART-4，运行 ART-2 → 由 RED → GREEN

Step 4：改动 A+D（codex-bridge）
  └─ ART-5，ssh xian-m4 部署，smoke 验证

Step 5：改动 smoke + CI
  └─ ART-6，确认 INV-4 守门仍然通过

Step 6：E2E 首弹验收
  └─ 按 contract-draft.md ## E2E 验收 步骤执行
  └─ 取 docker logs，写入 behavior_tests
```

---

## manual:bash 验收命令

### smoke-A：health 端点确认 docker_available 字段

```bash
# 验证 codex-bridge /health 含 docker_available
curl -s http://100.86.57.69:3458/health | jq 'has("docker_available")'
# 期望输出：true
curl -s http://100.86.57.69:3458/health | jq '.docker_available'
# 期望输出：true（OrbStack 已运行）或 false（未运行，需安装）
```

### smoke-B：静态字面量守门

```bash
# 确认无 HARNESS_XIAN_ENABLED / HARNESS_XIAN_BRIDGE_URL 字面量（INV-4）
grep -r 'HARNESS_XIAN_ENABLED\|HARNESS_XIAN_BRIDGE_URL' \
  /workspace/packages/brain/src/ \
  /workspace/packages/engine/
# 期望：无输出

# 确认 _spawnXianBridgeSession 和 skill-relay-xian 已存在
grep -n '_spawnXianBridgeSession\|skill-relay-xian' \
  /workspace/packages/brain/src/harness-skill-relay.js
# 期望：各至少一行
```

### smoke-C：task-router 单元覆盖

```bash
cd /workspace && npx vitest run \
  packages/brain/src/__tests__/task-router-xian-harness.test.js \
  --reporter=verbose
# 期望：全部 PASS，零 FAIL
```

### smoke-D：harness-skill-relay 单元覆盖

```bash
cd /workspace && npx vitest run \
  packages/brain/src/__tests__/harness-skill-relay-xian.test.js \
  --reporter=verbose
# 期望：全部 PASS，零 FAIL
```

### smoke-E：回归守门（INV-4 已有测试仍绿）

```bash
cd /workspace && npx vitest run \
  packages/brain/src/__tests__/executor-xian-env-passthrough.test.js \
  --reporter=verbose
# 期望：全部 PASS，零 FAIL
```

### smoke-F：E2E 首弹全链验收

```bash
# 1. 投递任务
TASK_ID=$(curl -s -X POST http://localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "task_type": "harness_initiative",
    "title": "xian harness smoke E2E",
    "location": "xian",
    "payload": {
      "allow_xian": true,
      "sprint_dir": "sprints/07171830-xian-harness-lane",
      "base_repo": "/Users/administrator/perfect21/cecelia"
    }
  }' | jq -r '.id')
echo "TASK_ID=$TASK_ID"

# 2. 等 30s，确认状态
sleep 30
curl -s "http://localhost:5221/api/brain/tasks/$TASK_ID" | jq '.status'
# 期望：in_progress

# 3. 确认 xian 容器存在
ssh xian-m4 "docker ps --filter 'name=cecelia-relay-xian' --format '{{.Names}}'"
# 期望：非空

# 4. 取容器日志
CONTAINER=$(ssh xian-m4 "docker ps --filter 'name=cecelia-relay-xian' -q | head -1")
ssh xian-m4 "docker logs $CONTAINER 2>&1 | head -30"
# 期望：含 HARNESS_TASK_ID 或 [harness-controller]，无 401 Unauthorized
```

---

## 验收完成标志

- [x] ART-1 + ART-2 测试文件已提交（RED commit 54fceaa 存在，历史可查）
- [x] ART-3 + ART-4 + ART-5 全部绿，单元测试 13/13 PASS
- [x] smoke-B/C/D/E 全部输出符合期望（smoke-A 需 xian-m4 实机验证）
- [ ] smoke-F 全链跑通：容器日志无 401，task 最终 completed（需 xian-M4 Docker 就绪后实测）
- [ ] PR 合并后回写 Brain task status（`status=completed, result.pr_url=...`）
- [ ] 未覆盖真实链路清单（见 contract-draft.md）3 项全部实测并记录结论
