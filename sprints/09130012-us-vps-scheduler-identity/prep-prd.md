# 小改动 PrepPRD：us-vps 机器身份纠偏 + 本机执行 fail-closed 守卫

task_id: 216b050a-773d-4939-896e-0a1eef4b3eae
change_kind: capability_change
map_scope: F2（部署闭环）, execution_pool（执行资源池）
gp-anchor: skipped (product-map.json not found, non-zenithjoy-workspace repo)

## 关键发现（改变了本刀的范围，实测于 2026-09-13 00:1x）

**远程派发机制本来就是开着的，守卫也已经存在。真正坏的只有两个 env 值。**

us-vps Brain 容器实测 env：

| env | 实际值 | 判定 |
|---|---|---|
| `KERNEL_FLEET_REMOTE_ENABLED` | **`true`** | ✅ 远程派发开关早已打开 |
| `KERNEL_FLEET_BRIDGE_TOKEN` | 已设置 | ✅ |
| `KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL` | `http://100.71.151.105:5221` | ✅ 经 MMV 端口转发可达 us-vps |
| `FLEET_WORKER_XIAN_MAC_M4_URL` | `http://100.86.57.69:5231` | ✅ 真 Tailscale 地址 |
| `FLEET_WORKER_XIAN_MAC_M1_URL` | `http://100.88.166.55:5231` | ✅ 真 Tailscale 地址 |
| `FLEET_WORKER_US_MAC_M4_URL` | `http://host.docker.internal:5231` | ❌ **占位符，Linux 容器内不通** |
| `CECELIA_MACHINE_ID` | `us-mac-m4` | ❌ **VPS 冒充 MMV** |

**完整因果链**：按铁律 `ca6bf8e7`，Claude 任务只能路由到 `us-mac-m4` → 而 us-vps 的机器身份**就叫** `us-mac-m4` → 被判定为"本机执行"而非"远程派发" → 走 `launchKernelProcess()` 本地 spawn → 近 30 天 442 条 `skill-relay` 活全压在 2 核 VPS 上 → CPU 打满 → 任务卡死。

**守卫已存在**：`packages/brain/src/orchestrator/production-transport.js:137`

```js
if (localMachineId !== DEFAULT_LOCAL_MACHINE_ID) {
  throw new Error(`invalid_local_execution_machine_id:${String(localMachineId)}`);
}
```

`DEFAULT_LOCAL_MACHINE_ID = 'us-mac-m4'`（同文件 :3）。也就是说「本地执行 transport 只许在 MMV 上创建」这道 fail-closed 闸**早就写好了**，只是因为 VPS 冒充 `us-mac-m4` 而从未触发。

⇒ **本刀不需要新写守卫，改成「改两个 env + 验证既有守卫在新身份下真的报错 + 补一个让它可见的启动自检」。**

## ⛔ 上一版方案已被证伪（2026-09-13 00:2x，Research Subagent REJECT + 亲验）

原方案「改 `CECELIA_MACHINE_ID` 为 `us-vps-scheduler`」**撤销**，纠正决策 `26c1e763`（supersede `962281b2`）。三条硬阻碍逐条亲验：

| # | 原假设 | 实际 | 证据 |
|---|---|---|---|
| 1 | `production-transport.js:137` 的守卫「已存在、只是没触发」 | **是死代码，生产不可达** | 判据是入参 `localMachineId`，默认值即 `DEFAULT_LOCAL_MACHINE_ID`；`server.js:145` 只传 `{env,fetchFn}`、`attempt-cleanup-worker.js:208` 只传 `{env}`，四个调用方全不传 → `if` 恒为假 |
| 2 | 「身份叫 us-mac-m4 → 判为本机执行 → 走 launchKernelProcess」 | **因果链不成立，改 env 不减一丝 CPU** | `harness-skill-relay.js` 全文 `machineId`/`CECELIA_MACHINE_ID`/`machine` 匹配行数 = **0**；本机 spawn 唯一判据是 `payload.harness_runtime === 'kernel-v1'`（:415/:420），且绕过 `production-transport` 直接 `nodeSpawn`（:149） |
| 3 | 改身份是安全的 | **会掐断凭据签发，全面 fail-closed** | `credential-broker.js:144` 与 `github-credential-broker.js:36` 硬编码 `controllerMachineId !== 'us-mac-m4'` 即 fail。这台 Brain 必须自称 `us-mac-m4`，因为它是凭据权威 |

`CECELIA_MACHINE_ID` 的真实语义 = **fleet 可调度节点身份 + 凭据签发权**，不是宿主物理机标识（`canonical-machine-id.js` 注释明示 hostname 被刻意忽略）。另有六处 allowlist 假设它恒等于 `us-mac-m4`，且历史上从未有人改过它。

## 改什么（方案 A，主理人 2026-09-13 拍板）

**不动 `CECELIA_MACHINE_ID`**，另开一个变量表达宿主角色，六处 allowlist 一处不碰。

1. **新增 env `CECELIA_LOCAL_EXECUTION_ENABLED`**（默认 `true` = 行为零变化；us-vps 上设 `false`）
2. **把闸加在真正的本机 spawn 点**：`harness-skill-relay.js` 的 `launchKernelProcess()`（:149）——这是元凶所在，不是 `production-transport`。`CECELIA_LOCAL_EXECUTION_ENABLED !== 'true'` 时**拒绝 spawn 并把任务 finalize 成带原因的终态**，绝不能走现在那条"spawn 返回 pid 就算 ok"的路径（`harness-skill-relay.js:300` vs `:303`），否则又变成静默卡到租约过期
3. **`docker-compose.us-vps.yml`**：`FLEET_WORKER_US_MAC_M4_URL` 默认值从 `http://host.docker.internal:5231` 改为 `http://100.71.151.105:5231`（真 MMV worker，本次会话已修好并验证 HTTP 200、docker/container/postgres 全绿）；并加 `CECELIA_LOCAL_EXECUTION_ENABLED=false`
4. **启动自检 + `/health`**：Brain 启动时若 `CECELIA_LOCAL_EXECUTION_ENABLED=false`，日志与 `/health` 显式声明「本机执行已禁用」，让状态可见
5. **CI 配置守卫**：按既有先例 `scripts/ci/__tests__/brain-deploy-url-points-to-us-vps.test.sh`（已挂 `ci.yml:684`）加断言，锁住 compose 里这两个默认值

## ⚠️ 加闸的已知后果（必须写明，不是 bug）

闸生效后，`harness_runtime === 'kernel-v1'` 的任务在 us-vps 上会被**明确拒绝**（带原因的终态），而不是偷偷在 VPS 上跑。这是有意的——把问题从"静默吃掉 2 核 CPU"变成"可见地拒绝"。

**代价**：在 handoff 缺口 1（skill-relay 远程化）完成之前，这类任务在 us-vps 上无法执行。受影响 task_type：`golden_path_proposal`、`harness_initiative`（kernel runtime）。

⇒ 所以缺口 1 是紧接着的下一刀，不是可选项。

## 为什么改

两条 invariant 铁律：

- **`96054a8b`**（2026-09-12 拍板）：us-vps 上的 Brain 和 OpenClaw 都只应该是任务调度器/分发器，不应在本机执行真实任务负载，执行全部下放 Mac worker
- **`ca6bf8e7`**（2026-09-09 拍板）：Claude Code 只在本机 MMV 运行，绝不铺到其它机器；西安 M1/M4 只跑 Codex；Grok 只在本机。**任何调度器需要 Claude 的任务一律路由到本机**。理由是 Claude 账号只有 2 个，跨机共用有 token 刷新竞争

当前违反状态（实测）：

- us-vps 的 compose 写着 `CECELIA_MACHINE_ID=us-mac-m4` —— **VPS 在冒充美国 M4**，fleet 账本里"us-mac-m4 在线"其实是 VPS 照镜子
- `FLEET_WORKER_US_MAC_M4_URL=http://host.docker.internal:5231` 在 Linux 容器里根本不通，真正的 MMV worker 从未被注册
- 结果：近 30 天 442 条 `orchestrator=skill-relay` 的活全在 us-vps 自己身上跑（`tasks.location` 近 30 天只有 `us` 一个值），这正是把 2 核 VPS 的 CPU 打满、导致任务卡死的架构根因

## 关联上下文

- 相关 Journey：工厂 · F2 部署闭环（capability）；横切件 execution_pool（执行资源池）
- 相关铁律：`96054a8b`（invariant）、`ca6bf8e7`（invariant）
- 相关 handoff：`docs/handoffs/202609122045-brain-pure-scheduler-handoff.md`（缺口 2「机器身份纠偏」、缺口 3「worker 侧服务起齐」）
- 相关 issue：`2fcd657c`（task 派发不动追踪）
- 验证靶子：task `feef7d3f`（一直 failed，改造落地后重跑端到端）

## 前置已完成（本次会话运维修复，非本 PR 范围）

三台 fleet worker 从 Brain 容器全部可达 HTTP 200：

| worker | Tailscale | docker | container | postgres | 本次做了什么 |
|---|---|---|---|---|---|
| `us-mac-m4`（MMV 本机，100.71.151.105） | active | ✅ | ✅ | ✅ | 绑定地址从 `127.0.0.1` 改为 Tailscale IP（plist + bootout/bootstrap 重载）；建 `/var/run/docker.sock` 软链 |
| `xian-mac-m4`（100.86.57.69） | active | ✅ | ✅ | ✅ | 启动 OrbStack；建 docker.sock 软链；`/var/log/cecelia` 权限 744→755 + 建日志文件 chown `_cecelia`（这是 launchd exit 78 的直接原因） |
| `xian-mac-m1`（100.88.166.55） | active | ❌ | ❌ | ❌ | 建了 docker.sock 软链，但缺系统级 docker CLI（它的在 `~/.orbstack/bin/`，worker 以 `_cecelia` 身份够不到）→ **遗留，不阻塞** |

> `xian-mac-m1` 的 docker 遗留项修法：传一个 26MB 的 docker CLI 二进制到 `/opt/homebrew/bin/`（跨国 scp 超时，M4→M1 无 ssh 密钥；需配密钥或走 device-transfer）。不阻塞本 PR——Claude 任务按 `ca6bf8e7` 本来就只去 MMV，M1 只跑 Codex 且非容器类活仍可接。

## 影响范围

- **动的是唯一生产 Brain 的派发主干**，高风险
- `CECELIA_MACHINE_ID` 变更会影响 fleet 账本里的机器注册与自我识别；需确认没有代码把 `us-mac-m4` 这个字面量当 VPS 自身身份硬编码
- 守卫是 fail-closed：一旦身份判定错误，会拒绝派发而不是错误执行（宁可停不可错）
- 不改 `task-router.js` 的 LOCATION_MAP 语义（那是 handoff 缺口 4，另一刀，本次只加守卫拦住违规路径）

## 测试策略：integration（不是 unit）

Research Subagent 定档理由：唯一有意义的断言跨 `harness-skill-relay` → 任务终态回写 多个模块；纯 unit 测容易重演「测了一段生产不可达代码」的错误（阻碍 1 就是活例）。环境接缝按 repo 既有先例走 shell 配置守卫。

| 接缝类型 | 守卫形态 | 放哪 | proven-to-fire 验证方式 |
|---|---|---|---|
| **逻辑/集成接缝**（拒绝本机 spawn 且优雅终态） | integration 测试：`CECELIA_LOCAL_EXECUTION_ENABLED=false` 时 `launchKernelProcess` 路径不 spawn，且任务落成**带原因的终态**（不是 ok:true 后静默卡死）；`=true` 时行为与现状逐字节一致 | `packages/brain/src/__tests__/` | 先写 failing test（commit-1），亲眼确认它红过，再实现（commit-2） |
| **环境接缝**（生产 env 配置） | shell 配置守卫：断言 `docker-compose.us-vps.yml` 里 `FLEET_WORKER_US_MAC_M4_URL` 默认值非 `host.docker.internal`、且 `CECELIA_LOCAL_EXECUTION_ENABLED=false` 在位 | `scripts/ci/__tests__/`（照 `brain-deploy-url-points-to-us-vps.test.sh` 先例，挂 `ci.yml`） | 故意把默认值改回占位符，确认守卫报红 |
| **运行时可见性** | Brain 启动自检 + `/health` 声明本机执行已禁用 | 打包进 Brain | 本机用 `CECELIA_LOCAL_EXECUTION_ENABLED=false` 起一次，确认 `/health` 真的带上该声明 |

## 验收标准

- [ ] failing test 先 commit（commit-1），亲眼确认它报红
- [ ] 实现让 test 变绿（commit-2）
- [ ] `CECELIA_LOCAL_EXECUTION_ENABLED=false` 时 kernel-v1 不在本机 spawn，且任务落**带原因的终态**（断言 reason 非空——这条直接对治「282 条 failed 只 35 条有原因」那个病）
- [ ] `CECELIA_LOCAL_EXECUTION_ENABLED` 缺省/`=true` 时行为零变化（防误杀，断言现状路径仍走通）
- [ ] `CECELIA_MACHINE_ID` **全程未被改动**（断言 compose 里仍是 `us-mac-m4`，防回归到已证伪方案）
- [ ] CI 配置守卫 proven-to-fire（把默认值改回占位符，亲眼看它报红）
- [ ] `/health` 在闸开启时显式声明本机执行已禁用
- [ ] DevGate 三闸通过：`node scripts/facts-check.mjs`、`bash scripts/check-version-sync.sh`、`node packages/quality/scripts/devgate/check-dod-mapping.cjs`
- [ ] CI 全绿
- [ ] 部署规矩：影子验证（换 `BRAIN_PORT` + `CECELIA_TICK_ENABLED=false`）→ 打基线镜像 tag → 人工切换 → 容器内直接验证；build 前先 `docker image prune`（us-vps 盘 82%，闸线 85%）

## 不包含（另立）

- **skill-relay 远程化**（handoff 缺口 1，最大头）：`harness-skill-relay.js:149` 的 `launchKernelProcess()` 本机 spawn 改接 fleet transport，需设计 worktree 如何到远程机、凭据 broker、回调链路
- **LOCATION_MAP 语义改造**（handoff 缺口 4）：71 个 task_type 从 `'us'` 改成机器定向派发
- **OpenClaw 并入同一台账**（handoff 缺口 5，独立轨道，非 Brain 代码）
- **Notion 双向同步**（凭据修复 + 派工字段推送）
- `xian-mac-m1` 的 docker CLI 补齐
