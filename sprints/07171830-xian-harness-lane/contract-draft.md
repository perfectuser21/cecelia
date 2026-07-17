# 合同草案 — 07171830-xian-harness-lane

> 版本：v1.0  
> 日期：2026-07-17  
> TASK_ID：7750cd32-d73b-4a53-91cf-8fd171bf358b  
> 铁律来源：sprint-prd.md INV-1 ～ INV-7

---

## 范围声明

打通 `harness_initiative` 在西安 xian-M4 上的完整派发链。本合同覆盖五个改动点：

- **A** `codex-bridge.cjs`：`/health` 端点补 `docker_available` 字段
- **B** `harness-skill-relay.js`：新增 `_spawnXianBridgeSession` 派发路径
- **C** `task-router.js`：`getTaskLocation` 支持按 `task.location` DB 字段动态覆盖
- **D** `codex-bridge.cjs`：`/run` 端点支持 `task_type=harness_relay`
- **E** failing test 先行（INV-5）

---

## 铁律绑定

| INV | 描述 | 本合同覆盖方式 |
|-----|------|---------------|
| INV-1 | 白名单门禁：xian 路径只接受 `payload.allow_xian=true` 任务 | 改动 B 中 xian 分支入口强制检查 `task.payload.allow_xian === true`，否则 loud 失败 |
| INV-2 | 容器内实弹验收（不能只 mock） | E2E 验收段要求在 xian 宿主上实际 `docker run -d`，验收命令取 `docker ps` + `docker logs` |
| INV-3 | 所有 xian-M4 操作走 bridge/ssh 留痕 | xian spawn 必须 POST `http://100.86.57.69:3458/run`，不本地 docker run |
| INV-4 | 严禁 `HARNESS_XIAN_ENABLED` / `HARNESS_XIAN_BRIDGE_URL` 字面量 | 所有路由通过 `task.location` DB 字段驱动；smoke 回归测试已覆盖 denylist |
| INV-5 | 先写 failing test 再写实现 | 改动 E 定义两个 failing test，须先 RED 提交，再写实现 |
| INV-6 | xian relay 纳入 harness_initiative 并发守护 | `_spawnXianBridgeSession` 落 `initiative_runs` 行，watchdog 可感知；dispatcher xianBypass 确认路径 |
| INV-7 | CODEX_RELAY_HOME 未配置时 loud 失败 | xian 路径通过 bridge payload `account_id` 字段指定凭据，不依赖本机 CODEX_RELAY_HOME；但若 bridge 明确返回 credentials 错误则 loud 失败回滚 task |

---

## 改动 A：codex-bridge.cjs `/health` 补 `docker_available`

**文件**：xian-M4 宿主上部署的 `codex-bridge.cjs`（与 repo 保持同步）

**行为**：
- GET `/health` 响应体新增字段 `docker_available: boolean`
- 探测逻辑：`execSync('docker info', { timeout: 3000 })` 成功 → `true`；抛异常 → `false`
- 探测失败不影响 `/health` 主体返回（降级为 `docker_available: false`，HTTP 200 照常返回）

**验收断言**：
```json
{ "status": "ok", "running_jobs": 0, "docker_available": true }
```
若 OrbStack/Docker 未运行则 `docker_available: false`。

---

## 改动 B：harness-skill-relay.js xian 派发路径

**文件**：`packages/brain/src/harness-skill-relay.js`

**注入点**：在 `spawnSkillRelaySession` 的去重守卫之后、B2/B3 codex 守门之前（约第 125 行），插入 xian 分支短路：

```js
// ─── xian 分支：task.location='xian' → bridge 派发 ─────────────────────────
const targetLocation = task.location || getTaskLocation(task.task_type);
if (targetLocation === 'xian') {
  return _spawnXianBridgeSession(task, { dbPool, now, short, initiativeId, deps });
}
// ─── end xian ────────────────────────────────────────────────────────────────
```

**新函数 `_spawnXianBridgeSession(task, ctx)`**：

```
1. 白名单门禁：task.payload.allow_xian !== true → loud 失败，回滚 task → queued
2. 容器名：cecelia-relay-xian-<short8>-<random4>
3. bridge payload：
   {
     task_id:         task.id,
     task_type:       'harness_relay',
     sprint_dir:      task.payload.sprint_dir,
     harness_task_id: task.id,
     brain_url:       process.env.XIAN_BRAIN_URL || 'http://100.86.57.69:5221',   // xian 侧 Tailscale IP，非 host.docker.internal；XIAN_BRAIN_URL 需在 Brain docker-compose.yml 和 .env 中配置
     callback_url:    `${process.env.XIAN_BRAIN_URL || 'http://100.86.57.69:5221'}/api/brain/harness/callback/${containerId}`,
     account_id:      task.payload.xian_account_id || 'team3',  // team3/4/5 轮换
   }
4. 调用：await spawnCodexBridgeDetached('http://100.86.57.69:3458/run', bridgePayload)
5. spawn 失败 → 回滚 task → queued，loud 错误日志，返回 { ok: false }
6. spawn 成功 → 落 initiative_runs 行：
   orchestrator_host = 'skill-relay-xian'
   phase = 'A_planning'
   deadline_at = NOW() + INTERVAL '8 hours'
7. 返回 { ok: true, mode: RELAY_FLAG, containerId, sprintDir }
```

**注意**：`spawnCodexBridgeDetached` 已存在于 `packages/brain/src/spawn/detached.js`，直接 import 复用，零新增依赖。

---

## 改动 C：task-router.js 动态 location 覆盖

**文件**：`packages/brain/src/task-router.js`

**现状**：`getTaskLocation(taskType: string)` 只查静态 `LOCATION_MAP`，`harness_initiative` 硬编码为 `'us'`（第 300 行）。

**修改**：函数重载支持对象入参：

```js
function getTaskLocation(taskTypeOrTask) {
  // 对象入参：task.location DB 字段优先（非 null/undefined 才覆盖）
  if (taskTypeOrTask && typeof taskTypeOrTask === 'object') {
    if (taskTypeOrTask.location != null) {
      return taskTypeOrTask.location;
    }
    // 对象但无 location 字段 → 回退到 task_type 静态映射
    const taskType = taskTypeOrTask.task_type;
    return LOCATION_MAP[taskType?.toLowerCase()] || DEFAULT_LOCATION;
  }
  // 原有字符串签名：零回归
  if (!taskTypeOrTask || typeof taskTypeOrTask !== 'string') {
    return DEFAULT_LOCATION;
  }
  return LOCATION_MAP[taskTypeOrTask.toLowerCase()] || DEFAULT_LOCATION;
}
```

**零回归保证**：所有现有 `getTaskLocation(string)` 调用路径行为不变；`task.location === null` 时等同于未设置，走静态 LOCATION_MAP。

---

## 改动 D：codex-bridge.cjs `/run` 支持 `harness_relay`

**文件**：xian-M4 宿主上的 `codex-bridge.cjs`

**行为**：
- POST `/run` 当 `body.task_type === 'harness_relay'` 时：
  1. `docker run -d --name <containerId> cecelia-claude` 并注入 env：
     - `HARNESS_TASK_ID`, `HARNESS_SPRINT_DIR`, `BRAIN_URL`, `HARNESS_NODE=controller`
     - `HARNESS_CALLBACK_URL`, `HARNESS_INITIATIVE_ID`
     - `GITHUB_TOKEN`（来自 Brain 侧 `harness-credentials.js` 的 `resolveGitHubToken()` 取值后放入 bridge payload）
     - `ANTHROPIC_API_KEY`（来自 Brain 侧 `process.env.ANTHROPIC_API_KEY` 取值后放入 bridge payload）
  2. 返回 `{ status: 'accepted', job_id: <containerId> }`（HTTP 200）
- docker 失败 → 返回 `{ error: '<message>' }`（HTTP 500）
- 校验：`task_id` / `brain_url` / `sprint_dir` 缺失 → `{ error: 'missing required field: ...' }`（HTTP 400）

**凭据方案（方案 B：无磁盘凭据）**：  
选择方案 B（无磁盘凭据）：通过 GITHUB_TOKEN 和 ANTHROPIC_API_KEY 等 env 注入，避免磁盘路径（`-v` volume 挂载）依赖。  
token 来源：Brain 侧通过 `harness-credentials.js` 的 `resolveGitHubToken()` 和 `process.env.ANTHROPIC_API_KEY` 取值后，放入 `spawnCodexBridgeDetached` 的 bridge payload，由 bridge 透传给容器 env。  
xian team3/4/5 账号标识通过 `account_id` 字段路由，bridge 内部负责按 account_id 映射对应 token。

---

## 改动 E：failing test 先行

**INV-5 强制**：先 RED 提交，再绿。

### E1：`task-router-xian-harness.test.js`

**路径**：`packages/brain/src/__tests__/task-router-xian-harness.test.js`

**核心测试**：
```
describe('getTaskLocation xian harness override', () => {
  it('task.location=xian + task_type=harness_initiative → returns xian', () => {
    const task = { task_type: 'harness_initiative', location: 'xian' };
    expect(getTaskLocation(task)).toBe('xian');  // 当前 failing：返回 'us'
  });
  it('task.location=null → 回退静态映射 → us', () => {
    const task = { task_type: 'harness_initiative', location: null };
    expect(getTaskLocation(task)).toBe('us');
  });
  it('string 签名零回归 → harness_initiative 仍返回 us', () => {
    expect(getTaskLocation('harness_initiative')).toBe('us');
  });
});
```

### E2：`harness-skill-relay-xian.test.js`

**路径**：`packages/brain/src/__tests__/harness-skill-relay-xian.test.js`

**核心测试**：
```
describe('spawnSkillRelaySession xian 派发路径', () => {
  it('task.location=xian → 调 spawnCodexBridgeDetached，不调 spawnDockerDetached', async () => {
    const mockBridgeFn = vi.fn().mockResolvedValue({ status: 'accepted', job_id: 'abc123' });
    const task = {
      id: 'test-123',
      task_type: 'harness_initiative',
      location: 'xian',
      payload: { allow_xian: true, sprint_dir: 'sprints/test' },
    };
    await spawnSkillRelaySession(task, {
      spawnFn: vi.fn(),           // docker spawn，不应被调
      bridgeFn: mockBridgeFn,     // bridge spawn，应被调
      pool: mockPool,
      loadSkill: () => 'skill content',
      ensureWt: async () => '/tmp/wt',
      tokenFn: async () => 'gh-token',
    });
    expect(mockBridgeFn).toHaveBeenCalledWith(
      'http://100.86.57.69:3458/run',
      expect.objectContaining({ task_type: 'harness_relay', brain_url: expect.stringContaining('5221') })
    );
    // 当前 failing：mockBridgeFn 未被调用，spawnDockerDetached 被调
  });

  it('task.location=xian 但 allow_xian 缺失 → loud 失败，不调 bridgeFn', async () => {
    const mockBridgeFn = vi.fn();
    const task = {
      id: 'test-456',
      task_type: 'harness_initiative',
      location: 'xian',
      payload: {},  // 无 allow_xian
    };
    const result = await spawnSkillRelaySession(task, { bridgeFn: mockBridgeFn, pool: mockPool });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/allow_xian/);
    expect(mockBridgeFn).not.toHaveBeenCalled();
  });
});
```

---

## E2E 验收

### 前提条件
**Step 0：确认 cecelia-claude 镜像已在 xian 宿主**
```bash
ssh xian-m4 "docker image inspect cecelia-claude 2>/dev/null && echo IMAGE_OK || echo IMAGE_NOT_FOUND"
# 若 IMAGE_NOT_FOUND：
ssh xian-m4 "docker pull <registry>/cecelia-claude:latest"
```

1. xian-M4 `docker info` 可用（`/health` 返回 `docker_available: true`）
2. Brain（US 侧）可通过 `http://100.86.57.69:5221` 从 xian 容器内访问（Tailscale）
3. `cecelia-claude` 镜像在 xian 宿主已拉取（见 Step 0）

### 验收步骤

**Step 1：投递一个非核心测试任务**
```bash
curl -X POST http://localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "task_type": "harness_initiative",
    "title": "xian harness smoke test",
    "location": "xian",
    "payload": {
      "allow_xian": true,
      "sprint_dir": "sprints/07171830-xian-harness-lane",
      "base_repo": "/Users/administrator/perfect21/cecelia"
    }
  }'
# 期望：返回 task_id（记为 $TASK_ID）
```

**Step 2：等 Brain tick 派发（最多 30s），确认 initiative_runs 落行**
```bash
curl "http://localhost:5221/api/brain/tasks/$TASK_ID" | jq '.status'
# 期望：in_progress

# 确认 initiative_runs 有 skill-relay-xian 记录
curl "http://localhost:5221/api/brain/tasks/$TASK_ID" | jq '.payload'
```

**Step 3：在 xian-M4 上验证容器存在**
```bash
ssh xian-m4 "docker ps --filter 'name=cecelia-relay-xian' --format '{{.Names}} {{.Status}}'"
# 期望：输出含 cecelia-relay-xian-<short8>-<rand4>，Status=Up
```

**Step 4：取容器日志，确认 skill 执行输出**
```bash
ssh xian-m4 "docker logs <container_name> 2>&1 | head -50"
# 期望：含 `[harness-controller]` 或 `HARNESS_TASK_ID`，**不含** `Missing bearer` / `401 Unauthorized`
```

**Step 5：等任务完成，确认 Brain task status 变更**
```bash
# 最多等 30 分钟（harness 任务时长）
curl "http://localhost:5221/api/brain/tasks/$TASK_ID" | jq '{status: .status, result: .result}'
# 期望：status=completed，result.pr_url 非空
```

### 验收失败判定
| 失败场景 | 判定方式 |
|---------|---------|
| bridge 不通 | `curl http://100.86.57.69:3458/health` 超时或非 200 |
| 白名单拦截未生效 | 无 allow_xian 任务未返回 error |
| 容器未启动 | `docker ps` 无 cecelia-relay-xian-* 记录 |
| 日志含 `401 Unauthorized` | INV-7 凭据未挂载，loud 失败 |
| Brain Tailscale 不可达 | xian 容器内 `curl http://100.86.57.69:5221/api/brain/ping` 失败 |

---

## 未覆盖真实链路清单

以下三项在本合同范围内**无法在代码层面验证**，须单独实机探测：

1. **xian-M4 Docker 是否已安装**  
   现状：`/health` 返回 `docker_available: false`（实测），说明 OrbStack/Docker 可能未运行或未装。需 SSH 进机器确认：`docker info` 是否可用；若未装，需 device-transfer 拉 OrbStack .pkg 安装。

2. **bridge `/run` 端点是否接受 `harness_relay` task_type**  
   现有 bridge 已部署版本的 `/run` 实现未知（只知道 `/health` 已有 `docker_available` 字段）。需实测 `curl -X POST http://100.86.57.69:3458/run -d '{"task_type":"harness_relay","task_id":"test",...}'` 确认是否返回 `{status:"accepted"}`；当前极可能返回 400/404（需改 D 后重新部署）。

3. **Brain Tailscale IP 从 xian 容器内的可达性**  
   xian relay 容器内的 `brain_url` 设为 `http://100.86.57.69:5221`（Tailscale IP）。容器内 Tailscale 网络是否透传取决于 docker 网络模式（host vs bridge）。`host` 模式可透传；`bridge` 模式需宿主上 Tailscale 守护进程转发。需实机验证：在 xian 宿主上 `docker run --rm cecelia-claude curl http://100.86.57.69:5221/api/brain/ping` 是否成功。

---

## Test Contract

| Workstream | 测试文件 | BEHAVIOR 覆盖 | 备注 |
|------------|---------|--------------|------|
| BEHAVIOR-1 | `../../packages/brain/src/__tests__/task-router-xian-harness.test.js` | task.location=xian + task_type=harness_initiative → returns xian | getTaskLocation 动态覆盖 |
| BEHAVIOR-2 | `../../packages/brain/src/__tests__/harness-skill-relay-xian.test.js` | BEHAVIOR-2: task.location=xian 但 allow_xian 缺失 → loud 失败，不调 bridgeFn | allow_xian 白名单门禁 |
| BEHAVIOR-3 | `../../packages/brain/src/__tests__/harness-skill-relay-xian.test.js` | BEHAVIOR-3: task.location=xian + allow_xian=true → 调 spawnCodexBridgeDetached 不调 spawnDockerDetached | xian 分支调 bridge |
| BEHAVIOR-4 | `../../packages/brain/src/__tests__/harness-skill-relay-xian.test.js` | BEHAVIOR-4: bridge spawn 成功 → DB INSERT 含 skill-relay-xian | initiative_runs 落行 |
| BEHAVIOR-5 | `../../packages/brain/src/__tests__/codex-bridge-health.test.js` | execSync("docker info") 成功 → docker_available=true | docker_available 字段 |
| BEHAVIOR-6 | `../../packages/brain/src/__tests__/harness-skill-relay-xian.test.js` | BEHAVIOR-6: bridge 抛异常 → task 回滚为 queued，返回 {ok:false} | bridge 失败回滚 |
| BEHAVIOR-7 | `../../packages/brain/src/__tests__/executor-xian-env-passthrough.test.js` | 源码完全不引用 HARNESS_XIAN_ENABLED / HARNESS_XIAN_BRIDGE_URL 字面量 | HARNESS_XIAN_ENABLED 禁用 |
| BEHAVIOR-8 | `../../packages/brain/src/__tests__/dispatcher-xian-harness-bypass.test.js` | task.location=xian + task_type=harness_initiative → xianBypass=true（池满时仍 dispatch） | xianBypass 判断 |
