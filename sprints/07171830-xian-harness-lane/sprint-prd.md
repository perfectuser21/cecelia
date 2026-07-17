# Sprint PRD — 07171830-xian-harness-lane

## 任务目标

打通 `harness_initiative` 在西安 xian-M4 上的完整派发链，使 `location=xian` 的 harness 任务能在西安侧 relay 容器（容器模式，executor=codex，team3/4/5 凭据）内跑完，不消耗 US Brain 宿主内存。具体三段：
1. **环境**：确认 xian-M4 OrbStack/Docker 可用（目前 codex-bridge `/health` 不返回 `docker_available`），必要时远程安装
2. **派发链**：在 task-router / harness-skill-relay / executor 三层补齐 `location=xian + task_type=harness_initiative` 路径（relay 容器在 xian 宿主上 `docker run -d`，凭据用 team3/4/5）
3. **首弹验收**：非核心任务全链跑通，附 xian 侧容器日志与 PR 原文

---

## Invariant 约束

从 `DEFINITION.md` / 代码 / decisions 提炼，本次改动必须全部遵守：

**INV-1 核心任务禁入白名单**
`harness_initiative` 对应的 xian 路径只接受非核心任务。白名单（payload 字段）驱动，非白名单 task_type 或无 `payload.allow_xian=true` 标记的任务不得路由到 xian。铁律来源：PrepPRD 第②③段"核心任务禁入（白名单只放非核心）"。

**INV-2 容器内实弹验收（宿主可用 ≠ 容器可用）**
历史四例案底证明：在 US 宿主上验证通过 ≠ xian 宿主容器内可用。验收必须在 xian 宿主上实际跑 `docker run -d`，取到容器日志，不能只在 US 侧 mock 或 curl bridge。来源：PrepPRD"容器内实弹验收（宿主验证≠容器可用四例案底）"。

**INV-3 西安机器操作走 bridge/ssh 留痕**
所有对 xian-M4 的操作必须经由 xian bridge（`http://100.86.57.69:3458`）或 ssh 执行，不得假设本地可达，操作记录留痕（日志 / smoke 输出）。来源：PrepPRD"西安机器操作走 bridge/ssh 留痕"。

**INV-4 HARNESS_XIAN 死开关严禁复活**
`executor.js` 严禁再出现 `HARNESS_XIAN_ENABLED` / `HARNESS_XIAN_BRIDGE_URL` 字面量（已有回归测试 `executor-xian-env-passthrough.test.js` + smoke `harness-xian-spawn-smoke.sh`）。新增的 xian harness 路径必须通过 `task.payload.location` 或 `task.location` DB 字段驱动，不走全局开关。来源：代码注释 + smoke denylist。

**INV-5 先写 failing test，再写实现**
必须先写能复现"无 xian 派发路径"的 failing test，再修代码让测试变绿。Bug fix 测试永久留在 CI（regression test），不能删。来源：CLAUDE.md Bug Fix 流程。

**INV-6 harness_initiative 全局并发上限守护**
`dispatcher.js` 对 `harness_initiative` 有进程级并发上限（`HARNESS_INITIATIVE_MAX_CONCURRENT`）。xian 侧 relay 属于 harness_initiative 的变体，必须同样纳入计数，不得绕过该上限。来源：`dispatcher.js:55-80`。

**INV-7 CODEX_RELAY_HOME 必须配置，禁止静默降级**
codex 路径 relay 容器的凭据目录 `CODEX_RELAY_HOME` 若显式设为空字符串则 loud 失败，不降级为无凭据 spawn 再秒退。xian 侧 team3/4/5 凭据目录必须通过此机制（或等价环境变量）挂载。来源：`harness-skill-relay.js:135-148`。

---

## 累积 FR（功能需求）

### FR-1 探测 xian-M4 docker/OrbStack 可用性
- 通过 xian bridge 或 ssh 探测 `docker info` / `docker ps` 是否返回成功
- codex-bridge `/health` 补充 `docker_available: boolean` 字段（与 PrepPRD 预期对齐）
- 不可用时输出可操作步骤（OrbStack 安装命令），国内下载慢走 device-transfer

### FR-2 task-router：新增 `harness_initiative_xian` 任务类型或条件路由
- 当 `task.location === 'xian'`（DB 字段）且 `task.task_type === 'harness_initiative'` 时，`getTaskLocation` 返回 `'xian'`
- 现状：`task-router.js:300` 硬编码 `harness_initiative: 'us'`，需按 DB `location` 字段动态覆盖
- failing test：mock task `location='xian'` `task_type='harness_initiative'` → `getTaskLocation` 返回 `'xian'`（当前返回 `'us'`，测试 failing）

### FR-3 executor：harness_initiative 路径增加 xian relay 分支
- 当 `task.location === 'xian'` 时，`runHarnessInitiativeRouter` 前增加 xian 路径短路
- xian 路径：调用 `spawnSkillRelaySession`，但 `spawnFn` 改为 `spawnCodexBridgeDetached`（POST 到 `http://100.86.57.69:3458/run`），而非本机 `docker run -d`
- failing test：mock location=xian harness 候选 → 现版本走 US docker spawn → 期望走 xian bridge spawn（failing）

### FR-4 harness-skill-relay：新增 xian-bridge spawn 路径
- `spawnSkillRelaySession` 增加第三分支：`task.location === 'xian'` → 走 `spawnCodexBridgeDetached`（已存在于 `spawn/detached.js`，直接复用）
- 容器名规约：`cecelia-relay-xian-<short8>-<random4>`，区别于 US 容器名（避免 watchdog 混淆）
- 凭据：bridge 侧 team3/4/5 账号，通过 bridge payload `account_id` 字段指定（或 bridge 自行轮换）
- `orchestrator_host`：`'skill-relay-xian'`（区别于 `'skill-relay-session'` / `'skill-relay-codex'`）

### FR-5 dispatcher：xian harness_initiative 绕过 cecelia-run 池限制
- `dispatcher.js:327-344` 已有 `xianBypass` 逻辑（xian 类任务不占 task_pool），需确认 `harness_initiative` 在 `location=xian` 时也走 bypass
- 当前 bypass 逻辑依赖 `getTaskLocation(nextType) === 'xian'`，若 FR-2 修好则自动生效，需确认

### FR-6 codex-bridge：支持 harness relay 容器任务（/run 端点扩展）
- `POST /run` 新增 `task_type: 'harness_relay'` 处理，在 xian 宿主上 `docker run -d` 启动 `cecelia-claude` 容器跑 harness-controller skill
- 参数透传：`task_id, sprint_dir, brain_url, github_token, harness_task_id` 等通过 docker env 注入
- `/health` 补 `docker_available` 字段：`execSync('docker info')` 成功 → true，失败 → false

### FR-7 首弹实弹验收（非核心任务）
- 选一个非核心任务（如 ci-poll SSOT 修复同款）设 `location='xian'`，全链跑通
- 验收证据：xian 宿主 `docker ps` 显示 relay 容器存在，`docker logs <container>` 有 skill 执行输出，Brain 侧 task 从 `in_progress` → `completed`，有 PR URL
- behavior tests 附 xian 侧容器日志与 PR 原文

---

## 实现路径（分阶段）

### Stage 0：环境探测 + docker_available 修复（先决条件）
1. SSH/bridge 探测 xian-M4 docker 状态：`curl http://100.86.57.69:3458/health`
2. 修复 `codex-bridge.cjs` `/health` 端点，加 `docker_available` 字段（`docker info` 探活）
3. 若 OrbStack 未装：拉 `.pkg` 安装包 via device-transfer，远程安装

### Stage 1：failing test 先行（FR-2 / FR-3）
1. 新建 `packages/brain/src/__tests__/task-router-xian-harness-initiative.test.js`
   - `task.location='xian'` + `task_type='harness_initiative'` → `getTaskLocation` 期望 `'xian'`（当前 failing）
2. 新建 `packages/brain/src/__tests__/harness-skill-relay-xian-spawn.test.js`
   - mock `task.location='xian'` → `spawnSkillRelaySession` 应调 `spawnCodexBridgeDetached`（当前 failing，实际调 `spawnDockerDetached`）

### Stage 2：task-router 动态 location 覆盖（FR-2）
- `task-router.js` `getTaskLocation(task)` 函数：若 `task` 对象传入且 `task.location` 不为 `null`，优先返回 `task.location`，覆盖 `LOCATION_MAP` 静态值
- 注意：静态调用 `getTaskLocation(taskType: string)` 签名不变（零回归）

### Stage 3：harness-skill-relay xian spawn 路径（FR-4）
- `spawnSkillRelaySession` 在去重守卫之后，增加：
  ```
  const targetLocation = task.location || getTaskLocation(task.task_type);
  if (targetLocation === 'xian') {
    return _spawnXianBridgeSession(task, { dbPool, now, short, initiativeId, deps });
  }
  ```
- `_spawnXianBridgeSession`：调 `spawnCodexBridgeDetached`，落 `initiative_runs` 行（`orchestrator_host='skill-relay-xian'`）

### Stage 4：codex-bridge /run 端点扩展（FR-6）
- 在 xian-M4 上修改 `codex-bridge.cjs`，`POST /run` 支持 `task_type='harness_relay'`
- docker run -d 启动 cecelia-claude 镜像，注入 env，返回 `{ status: 'accepted', job_id: containerId }`

### Stage 5：dispatcher bypass 确认 + 首弹验收（FR-5 / FR-7）
- 确认 xian bypass 逻辑对 `harness_initiative` 生效
- 投递首弹任务，观察 xian 容器日志，写 behavior_tests

---

## NFR（非功能需求）

- **NFR-1 零回归**：现有 US 路径（`task.location='us'` 或 `location` 为 null）行为完全不变；静态 `getTaskLocation(string)` 调用签名不变
- **NFR-2 fail-loud**：xian 路径 spawn 失败（bridge 不通 / 凭据错误）必须 loud 失败并回滚 task 为 queued，不静默降级到 US 路径
- **NFR-3 留痕**：所有 xian-M4 操作通过 bridge/ssh 执行，输出写到 smoke 日志，PR 可追溯
- **NFR-4 smoke 可复现**：新增 `harness-xian-relay-smoke.sh` 静态验证 `harness-skill-relay.js` 含 `_spawnXianBridgeSession` + `skill-relay-xian` 字面量；运行时 mock bridge 接受 POST
- **NFR-5 并发守护**：xian relay 落行 `initiative_runs`，watchdog 和并发上限逻辑不绕过

---

journey_type: infra
target_environment: local_api
