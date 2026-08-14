# Sprint Contract Draft (Round 1) — Fleet Worker 实例互杀防护 + quarantined attempt 终态闭环

> 实现基线（frozen implementation baseline）：`perfectuser21/cecelia` @ `02f315eea80ea6c0f3e4e147ae2183d19a456b7d`（inputs.implementation_baseline，跨角色/跨 GAN 轮不变）。
> 本角色 checkout：`da3da3bf55143a495130ceae94c2ebcc21e59d21`（仅选取 proposer 工作区，不替换实现基线）。
> gp-anchor: skipped (product-map.json not found)
> contract-gate: cecelia worktree（`packages/brain/src/lib/contract-gate.js` 存在）——代码层 Contract Gate 生效，断言按下方速查表惯用法书写。

## 锚定父路声明

覆盖父路: **独立小路（无父路）** —— journey `e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29` 暂无 ability_status=done/working 的已验收 golden-path step（累积 FR 为空），本 sprint 是纯 backend 稳定性修复，无可锚定父路。

## Response Schema（推导来源: PRD 字面）

**N/A — 任务无 HTTP 响应。** 本 sprint 是 `packages/brain` 内部 Fleet Worker attempt 生命周期与 Docker 资源治理，无对外 HTTP 端点、无 request/response body。可观测契约落在 **PostgreSQL `harness_attempts` 表状态** 与 **真实 Docker 容器/网络存活性** 上（见下方各 Step 的验证命令）。Reviewer 第 6 维按 DB/Docker oracle 完整性审查。

### 可观测数据契约（替代 HTTP schema — 真实列名已 psql/migration 核对）

- 表名：`harness_attempts`（**非** `attempts`；PRD 占位文字 "attempts" 实指此表，来源 migration 357/361/362/363/381）
- 涉及真实列（migration 核对）：`id`、`run_id`、`hop`、`status`、`result`(jsonb)、`error_code`、`error_message`、`lease_expires_at`、`lease_owner`、`retry_of_attempt_id`(uuid, FK→harness_attempts.id)、`restart_reason`(text)、`attempt_kind`、`logical_cycle_id`、`workstream_key`、`execution_transport`、`created_at`
- `status` 枚举（migration 357 CHECK，铁律 [status枚举]：不得新增枚举值）：`queued/starting/running/completed/completed_with_concerns/needs_context/blocked/failed/cancelled` —— **无 `quarantined`**。PRD "quarantined attempt" = 过期卡死的 active attempt（`status IN (queued,starting,running)` 且 `lease_expires_at < NOW()`），终态化目标为 **`failed`**（既有枚举），不新建状态值。
- `attempt_kind` 枚举（migration 361/362 CHECK）：`initial/fix/retry/resume/recovery` —— replacement 用既有 `resume`，不新增。
- `execution_transport` 枚举（migration 381 CHECK）：`local-docker/remote-bridge/fleet-worker`。
- Docker 资源命名/标签（attempt-resources.cjs 实证）：容器 `cecelia-pg-<attemptId>`、网络 `cecelia-attempt-<attemptId>`；标签 `cecelia.fleet.attempt_id=<attemptId>`、`cecelia.fleet.resource=postgres`。**本 sprint 新增实例维度标签 `cecelia.fleet.instance=<namespace>`**（[AI_ADDED]，见 Step 2）。

## Unified Map 半径

map_scope=`cecelia`、map_repo=`perfectuser21/cecelia` 已配置，但 task.payload.expected_files 为空（`[]`）→ radius 无法计算 affected_business_nodes，`must_run_assertions` 为空集。标 `[MAP_RADIUS_EMPTY: expected_files=[]]`，不回退领域硬编码；回归约束以下方"已知约束"章节为准。

## 已知约束（来自回归测试 + 累积 FR）

- [attempt-resources.test.cjs] → "creates a private network and healthy pinned PostgreSQL sidecar with ephemeral credentials"（PG sidecar 命名/标签/健康契约不得回退）
- [attempt-resources.cjs reconcile()] → 现状仅按 `label=cecelia.fleet.resource=postgres` 过滤 + `retainedAttemptIds` 保留，**无实例维度**——本 sprint 修复点
- [kernel-stale-attempt-reconcile.pg.integration.test.js] → 真 PostgreSQL 上 stale attempt 终态化 + 事务幂等（`scripts/kernel-stale-attempt-reconcile.mjs` 的 `reconcileStaleAttempts` 入口不得回退）
- [harness-relay-watchdog.test.js] → `reconcileExpiredKernelAttempt` 生成 child 时 `retry_of_attempt_id`/`restart_reason`/`attempt_kind='resume'` 契约
- [累积FR] （本 line 暂无已验收历史；journey e6f803f2 唯一 ability "Agent 一键归零重置" 状态 planned，未纳入）
- context-manifest: unavailable（无 journey context-manifest 端点数据，记录一行，不静默跳过）

---

## Golden Path

[同机多实例并存 + attempt 生命周期变更] → [按实例 namespace 隔离的 reconcile / 一次事务终态化 + restart_reason lineage] → [各实例资源互不侵犯、quarantined 闭环可查证 + postgres runtime 真起]

### Step 1: 实例 namespace 生成、持久化、重启稳定（场景 B 1-2）
**来源**: `[FROM_PRD]` — PRD 场景 B 第 1-2 步 + 假设 "instance namespace 以 data root 路径为持久化锚点，同 data root 复启得同 namespace"（sprint-prd.md 第 22-24、53 行）

**可观测行为**: Worker 首次启动在 `workspace-manager.cjs` 生成 instance namespace 并持久化到 data root 下的持久文件；重启（再次以同一 data root 调用）从持久文件读取，返回**相同** namespace（非冷启动路径也稳定，铁律 [非冷启动覆盖]）。

**验证命令**（真实 fs，无 mock；构造签名以 workspace-manager.cjs 实证为准 `{mirrorRoot,worktreeRoot,quarantineRoot,repoAllowlist(对象)}`）:
```bash
node -e '
const {createWorkspaceManager}=require("./packages/brain/scripts/fleet-worker/workspace-manager.cjs");
const os=require("os"),fs=require("fs"),path=require("path");
const base=fs.mkdtempSync(path.join(os.tmpdir(),"fleet-ns-"));
const roots={mirrorRoot:path.join(base,"m"),worktreeRoot:path.join(base,"w"),quarantineRoot:path.join(base,"q"),repoAllowlist:{"perfectuser21/cecelia":"https://github.com/perfectuser21/cecelia.git"}};
for(const k of ["mirrorRoot","worktreeRoot","quarantineRoot"]) fs.mkdirSync(roots[k],{recursive:true});
const m1=createWorkspaceManager(roots);
const a=m1.resolveInstanceNamespace();               // 首次生成+持久化
const b=m1.resolveInstanceNamespace();               // 同实例再读（非冷启动）
const m2=createWorkspaceManager(roots);              // 模拟 Worker 重启：同 roots 新实例
const c=m2.resolveInstanceNamespace();               // 从持久化读取
if(!a||a!==b||a!==c){console.error("FAIL: namespace 重启不稳定",a,b,c);process.exit(1);}
console.log("OK",a);'
# 期望：三次读取（含重启后 m2）相等，stdout 含 OK；退出码 0
```

**硬阈值**: 同一组 roots 下三次读取（含重启新实例 m2）字符串相等。**验证命令**：上述 node 脚本 exit 0。

---

### Step 2: reconcile 按实例 namespace 隔离，绝不跨实例误删（场景 A 2-3）
**来源**: `[FROM_PRD]` — PRD 场景 A 第 2-3 步（sprint-prd.md 第 19-20 行）；`cecelia.fleet.instance` 标签为 `[AI_ADDED]`，理由：现有 `cecelia.fleet.attempt_id` 只能区分 attempt，无法区分"同 machine_id 不同 data root 的两个 Worker 实例"，必须新增实例维度标签+过滤，否则 reconcile 的 `docker ps --filter label=cecelia.fleet.resource=postgres` 会捞到对方实例容器并 `docker rm -f` 互杀。

**可观测行为**: Worker-A 的 `reconcile({ retainedAttemptIds })` 只对 **带自己 instance namespace 标签** 且不在 retained 集合的容器/网络执行 stop/rm；Worker-B（不同 namespace）的容器/网络不出现在 `removed_attempts` 中、真实 Docker 中仍存活。

**验证命令**（接缝真验 = 真 Docker，见 `## E2E 验收` 场景 A；此处给可机检的过滤逻辑单验，真 daemon 侧由 E2E 复演）:
```bash
# 真实 attempt-resources 模块 + 注入两 namespace 的 docker 输出：Worker-A reconcile 不得收割 Worker-B 的 attempt
node -e '
const {createAttemptResourceManager}=require("./packages/brain/scripts/fleet-worker/attempt-resources.cjs");
const A="11111111-1111-4111-8111-111111111111", B="22222222-2222-4222-8222-222222222222";
const rm=[];
const runCommand=async(cmd,args)=>{
  if(args[0]==="ps") return {stdout:`cecelia-pg-${A}\t${A}\tns-A\ncecelia-pg-${B}\t${B}\tns-B`};
  if(args[0]==="network"&&args[1]==="ls") return {stdout:`cecelia-attempt-${A}\t${A}\tns-A\ncecelia-attempt-${B}\t${B}\tns-B`};
  if(args[0]==="rm"||(args[0]==="network"&&args[1]==="rm")) rm.push(args.join(" "));
  return {stdout:""};
};
const m=createAttemptResourceManager({runCommand, instanceNamespace:"ns-A", postgresImageDigest:"postgres:16-alpine@sha256:"+"f".repeat(64)});
m.reconcile({retainedAttemptIds:[]}).then(r=>{
  if(r.removed_attempts.includes(B)){console.error("FAIL: 跨实例误删 Worker-B",r.removed_attempts);process.exit(1);}
  if(rm.some(x=>x.includes(B))){console.error("FAIL: 对 Worker-B 发了 rm",rm);process.exit(1);}
  console.log("OK removed=",JSON.stringify(r.removed_attempts));
}).catch(e=>{console.error("FAIL",e.message);process.exit(1);});'
# 期望：Worker-B(B) 不在 removed_attempts、无 rm 命令；exit 0
```

**硬阈值**: `removed_attempts` 不含 Worker-B 的 attemptId；无任何针对 `cecelia-pg-<B>` / `cecelia-attempt-<B>` 的 `docker rm`。**真目标验证**：`## E2E 验收` 场景 A 用真实 Docker 双 data root 复演 Worker-B 容器存活。

---

### Step 3: 旧无 namespace 标签容器 fail-closed（场景 B 3 + 边界）
**来源**: `[FROM_PRD]` — PRD 场景 B 第 3 步 + 边界"无 namespace 的历史容器：fail-closed，不删不改，仅告警"（sprint-prd.md 第 25、41 行）

**可观测行为**: reconcile 遇到**缺 `cecelia.fleet.instance` 标签**的历史容器时，**不**将其纳入 `removed_attempts`（拒绝盲扫删除），并给出 fail-closed 信号（告警/结构化 fail_closed 计数），交人工处理。

**验证命令**:
```bash
node -e '
const {createAttemptResourceManager}=require("./packages/brain/scripts/fleet-worker/attempt-resources.cjs");
const OLD="33333333-3333-4333-8333-333333333333";
const rm=[];
const runCommand=async(cmd,args)=>{
  if(args[0]==="ps") return {stdout:`cecelia-pg-${OLD}\t${OLD}\t`};   // instance 标签为空 = 旧容器
  if(args[0]==="network"&&args[1]==="ls") return {stdout:""};
  if(args[0]==="rm"||(args[0]==="network"&&args[1]==="rm")) rm.push(args.join(" "));
  return {stdout:""};
};
const m=createAttemptResourceManager({runCommand, instanceNamespace:"ns-A", postgresImageDigest:"postgres:16-alpine@sha256:"+"f".repeat(64)});
m.reconcile({retainedAttemptIds:[]}).then(r=>{
  if(r.removed_attempts.includes(OLD)){console.error("FAIL: 删了旧无namespace容器",r);process.exit(1);}
  if(rm.length>0){console.error("FAIL: fail-closed 应零删除，实发",rm);process.exit(1);}
  if(!Array.isArray(r.fail_closed)||!r.fail_closed.includes(OLD)){console.error("FAIL: 无 fail_closed 告警信号",r);process.exit(1);}
  console.log("OK fail_closed=",JSON.stringify(r.fail_closed));
}).catch(e=>{console.error("FAIL",e.message);process.exit(1);});'
# 期望：removed_attempts 不含旧容器、rm 零调用、r.fail_closed 含旧容器 id；exit 0
```

**硬阈值**: 旧无 namespace 容器不被删除，且进入 `fail_closed` 信号集。**验证命令**：上述 node 脚本 exit 0。

---

### Step 4: contract_requirements.postgres → runtime_resources.postgres 机械投影 + 真 PG 起容器（场景 D）
**来源**: `[FROM_PRD]` — PRD 场景 D 第 1-3 步 + 增量硬要求 B（sprint-prd.md 第 33-36、71 行）；本 attempt 自身 payload `contract_requirements={"postgres":true}` 已是活证据。

**可观测行为**: 当 task payload `contract_requirements.postgres===true` 时，系统**机械投影**为 `runtime_resources.postgres===true`（无遗漏、无手工分叉）；attempt 运行时用 attempt-resources.cjs 真起 `cecelia-pg-<id>` 容器，`pg_isready` 返回 accepting connections。

**验证命令**（投影逻辑单验；真 PG 起容器由 `## E2E 验收` 场景 D 复演）:
```bash
node -e '
const {projectContractRequirements}=require("./packages/brain/scripts/fleet-worker/attempt-runner.cjs");
const out=projectContractRequirements({contract_requirements:{postgres:true}});
if(out.runtime_resources.postgres!==true){console.error("FAIL: 投影未产出 postgres:true",out);process.exit(1);}
const off=projectContractRequirements({contract_requirements:{postgres:false}});
if(off.runtime_resources.postgres!==false){console.error("FAIL: false 未投影为 false",off);process.exit(1);}
console.log("OK",JSON.stringify(out.runtime_resources));'
# 期望：postgres:true→runtime_resources.postgres===true；false→false；exit 0
```

**硬阈值**: `contract_requirements.postgres` 逐字段机械映射到 `runtime_resources.postgres`。**真目标验证**：`## E2E 验收` 场景 D `pg_isready` 真容器。

---

### Step 5: expired attempt 一次事务终态化 + append-only evidence + replacement restart_reason lineage + 幂等（场景 C）
**来源**: `[FROM_PRD]` — PRD 场景 C 第 1-4 步 + 增量硬要求 A + NFR 原子性/幂等/证据/可观测（sprint-prd.md 第 27-31、67-72 行）；`[AI_ADDED]`：lineage SQL 反查断言（`retry_of_attempt_id` JOIN 自身），理由：防止 generator 用"只写 restart_reason 不建父子链"糊弄，强制可从子 attempt SQL 反查根因。

**可观测行为**（真 PostgreSQL，无 mock DB 边）:
1. 一个 active 且 `lease_expires_at < NOW()` 的 attempt 被 reconcile 后，**一次事务**内 `status='failed'` 且 `error_code`/`result` evidence 落库（append-only，不覆盖既有 evidence 历史）
2. 生成 replacement child：`attempt_kind='resume'`、`retry_of_attempt_id=<parent.id>`、`restart_reason` 非空且结构化（继承并记录根因）
3. lineage 可 SQL 反查：`SELECT ... FROM harness_attempts child JOIN harness_attempts parent ON child.retry_of_attempt_id=parent.id`
4. 重复 reconcile **幂等**：不产生第二个 child（`uq_harness_attempts_run_hop` 兜底），parent 不二次终态化

**验证命令**（真 PG，$DB_URL 由 Fleet 注入的空库；见 `## E2E 验收` 场景 C 全量脚本）:
```bash
# 见 ## E2E 验收 场景 C：migrate 空库 → 插入 expired parent → reconcile → 断言 failed+lineage → 二次 reconcile 断言幂等
echo "Scenario C 真 PG 复演见 ## E2E 验收 场景 C（此处不重复脚本，避免与 E2E 段拼接冲突）"
```

**硬阈值**: parent `status='failed'`；child 存在且 `retry_of_attempt_id=parent.id AND restart_reason IS NOT NULL AND attempt_kind='resume'`；二次 reconcile 后 child 计数不变。**验证命令**：见 `## E2E 验收` 场景 C 的 psql `jq/grep` 断言。

---

## 禁 mock 边清单

本单改动涉及【状态机】（expired→failed 终态化 + attempt_kind 迁移）、【跨模块数据传递】（reconcile↔attempt-runner↔watchdog 的 namespace/restart_reason 透传）、【生命周期钩子】（reconcile/quarantine 编排）、【DB 写路径】（harness_attempts 终态化 + child 写入），故以下边**禁 mock**：

- **harness-relay-watchdog / kernel-stale-attempt-reconcile ↔ `harness_attempts`（PostgreSQL）**：场景 C 的 failing 测试与 [BEHAVIOR] 必须真 Postgres（`pg` + 真 `src/migrate.js` 空库），断言真实行落库/父子链/幂等，禁止 mock DB。放 `packages/brain/src/__tests__/integration/*.pg.integration.test.js` 并登记进 `packages/brain/vitest.config.js` 的 `POSTGRES_INTEGRATION_TESTS`（由 brain-integration job 起真 PG 跑）。
- **attempt-resources.cjs `reconcile()` ↔ Docker daemon**：场景 A/B/D 的**接缝真验**必须真 Docker（`## E2E 验收` 双 data root、真 `cecelia-pg-*` 容器、`pg_isready`）。单元 red-green 允许注入 `runCommand` 打桩 Docker CLI **仅用于过滤/解析逻辑**（namespace 匹配、fail-closed 判定），但该逻辑的**真目标验证**在 E2E 真 daemon，不以打桩绿冒充 done。
- **workspace-manager.cjs ↔ data root 文件系统**：namespace 持久化/重启读取用真实 `fs`（mkdtemp 临时目录），禁止 mock fs。

（无纯 UI/纯文档豁免项。）

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | ①reconcile 按 instance namespace 隔离；②namespace 生成/持久化/重启稳定；③旧无 namespace 容器 fail-closed；④expired attempt 一次事务终态化+append-only evidence+replacement lineage+幂等；⑤contract_requirements.postgres→runtime_resources.postgres 投影真起 PG |
| **NFR（做得多好）** | 非功能 | 原子性（单事务终态化）；幂等（重复 reconcile 无副作用）；隔离（只作用本 namespace）；证据 append-only；postgres 走真 Docker + pg_isready |
| **Invariant（永不违反）** | 不变量 | 跨实例绝不误删（fail-closed）；status 不新增枚举（终态=failed，kind=resume）；evidence 不覆盖历史；attempts 表真实列名先核对 |
| **判定点（怎么知道）** | 见下方登记表 | 见登记表 |
| **保质期（何时过期）** | 失效 | attempt 过期由 `lease_expires_at` 界定；instance namespace 与 data root 同生命周期（data root 存在即有效） |
| **死亡告警（停了谁知道）** | 告警 | reconcile 无法终态化/遇旧无 namespace 容器 → `onRecoveryAlert`/brain_alerts 告警（fail_closed 信号），主理人可见 |
| **失败语义（挂了怎么办）** | 故障 | 终态化事务失败=不留半开：parent+child 均落终态失败证据（拦截，不放行）；Docker rm 目标已不存在=视为已释放；namespace 持久文件读失败=fail-closed（拒绝盲扫删） |
| **效果确认（已发≠已生效）** | 回执 | postgres：`pg_isready` accepting connections；replacement：SQL lineage JOIN 反查到 parent；隔离：`docker ps` 确认对方容器存活；终态化：`psql` 查 parent.status='failed' + child 行 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ 某 attempt 是否"expired 需终态化" | A. `lease_expires_at < NOW()` 且 `status IN (queued,starting,running)`; B. 固定超时墙钟 | A | 复用 Controller lease 语义（已部署），与 watchdog 既有判据一致 | 误判活跃 attempt 为过期→误终态化正在跑的任务（直接面客错误，不可逆） |
| ⚠️ 某容器是否属"本实例可回收" | A. `cecelia.fleet.instance` 标签 == 本 Worker namespace 且不在 retained; B. 仅按 resource=postgres 标签(现状) | A | 现状 B 会跨实例误删（本 sprint 根因） | 误判他实例容器为自己→`docker rm -f` 互杀（静默丢他人运行中 attempt，不可逆） |
| ⚠️ 旧容器无 namespace 标签时如何处置 | A. fail-closed 不删仅告警; B. 视为本实例删除 | A | 无法证明归属→保守不删（PRD 边界硬约束） | 选 B 会误删历史/他实例容器（不可逆） |
| replacement 是否已生成（幂等判定） | A. `uq_harness_attempts_run_hop` 唯一约束 + 查 child 存在; B. 应用层计数 | A | DB 唯一约束是并发下唯一可靠幂等闸 | 误判→二次生成 replacement 或重复终态化（脏 lineage） |

（本任务无对外 agent 输入，输入对抗面 N/A。）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| expired 终态化事务中途失败 | 不留半开：parent+child 均落终态失败证据 | 是（幂等键=run_id+hop 唯一约束） | 交 controller/人工，append-only evidence 留痕 |
| reconcile 遇旧无 namespace 容器 | fail-closed：不删不改，记 fail_closed + 告警 | 是（无副作用） | 人工介入 |
| Docker rm 目标已不存在 | 视为已释放（isExplicitlyMissing），不报错 | 是 | 无 |
| namespace 持久文件读失败 | fail-closed：拒绝盲扫删除 | 是 | 告警 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| N/A（内部 Fleet Worker，无对外 agent 暴露） | N/A | N/A | N/A |

---

## E2E 验收（final-e2e 跑 — target_environment=local_api，真实 Docker 双 data root + 真实 PostgreSQL）

**journey_type**: autonomous
**target_environment**: local_api

> 单一 bash 块（evaluator 1.22.0 按序拼接全部 bash 块；本段仅一块，避免拼接冲突）。
> Fleet 注入 attempt 独享空库 `$DB_URL`；脚本先跑仓库真实 migration 初始化空库，再复演四场景。
> 需真实 Docker（双 data root、真 `cecelia-pg-*` 容器、pg_isready）与真实 PostgreSQL（harness_attempts 终态化/lineage/幂等）。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
BRAIN_DIR="packages/brain"
SESSION_TMP="$(mktemp -d)"
DATA_ROOT_A="$SESSION_TMP/worker-a"
DATA_ROOT_B="$SESSION_TMP/worker-b"
mkdir -p "$DATA_ROOT_A" "$DATA_ROOT_B"
PGIMG="postgres:16-alpine"
CREATED_CONTAINERS=""
cleanup() {
  for c in $CREATED_CONTAINERS; do docker rm -f "$c" >/dev/null 2>&1 || true; done
  docker network rm e2e-net-a e2e-net-b >/dev/null 2>&1 || true
  rm -rf "$SESSION_TMP"
}
trap cleanup EXIT

# 0. 从 DB_URL 解析 DB_* 供 migrate.js（db-config 只认 DB_HOST/PORT/USER/PASSWORD/NAME，不认 DATABASE_URL）
eval "$(node -e '
const u=new URL(process.env.DB_URL);
const q=(s)=>String(s||"").replace(/\x27/g,"\x27\\\x27\x27");
process.stdout.write(
  "export DB_HOST="+q(u.hostname||"localhost")+"\n"+
  "export DB_PORT="+q(u.port||"5432")+"\n"+
  "export DB_USER="+q(decodeURIComponent(u.username||"cecelia"))+"\n"+
  "export DB_PASSWORD="+q(decodeURIComponent(u.password||""))+"\n"+
  "export DB_NAME="+q((u.pathname||"/").slice(1))+"\n");
')"
export NODE_ENV=test
# 空库跑真实 migration，机检 harness_attempts 表存在
( cd "$BRAIN_DIR" && node src/migrate.js )
psql "$DB_URL" -tAc "SELECT to_regclass('public.harness_attempts') IS NOT NULL" | grep -qx t \
  || { echo "FAIL: harness_attempts 表未由 migration 建出"; exit 1; }

# ============ 场景 D：contract_requirements.postgres → runtime_resources 投影 + 真 PG pg_isready ============
node -e '
const {projectContractRequirements}=require("./packages/brain/scripts/fleet-worker/attempt-runner.cjs");
const o=projectContractRequirements({contract_requirements:{postgres:true}});
if(o.runtime_resources.postgres!==true){console.error("FAIL: 投影缺 postgres:true");process.exit(1);}
console.log("OK projection");'
CID_D="e2e-pg-d-$$"
CREATED_CONTAINERS="$CREATED_CONTAINERS $CID_D"
docker run -d --name "$CID_D" -e POSTGRES_PASSWORD=e2epw "$PGIMG" >/dev/null
READY=0
for i in $(seq 1 30); do
  if docker exec "$CID_D" pg_isready -U postgres 2>/dev/null | grep -q "accepting connections"; then READY=1; break; fi
  sleep 1
done
[ "$READY" = 1 ] || { echo "FAIL: 场景D 真 PG 容器 pg_isready 未就绪"; exit 1; }
echo "OK 场景D 真 PG accepting connections"

# ============ 场景 A：双 data root 真容器互杀防护 ============
# 以真实 workspace-manager 构造签名派生各 Worker 的 instance namespace
ns_for() {
  node -e '
const {createWorkspaceManager}=require("./packages/brain/scripts/fleet-worker/workspace-manager.cjs");
const fs=require("fs"),path=require("path");const b=process.argv[1];
const roots={mirrorRoot:path.join(b,"m"),worktreeRoot:path.join(b,"w"),quarantineRoot:path.join(b,"q"),repoAllowlist:{"perfectuser21/cecelia":"https://github.com/perfectuser21/cecelia.git"}};
for(const k of ["mirrorRoot","worktreeRoot","quarantineRoot"]) fs.mkdirSync(roots[k],{recursive:true});
process.stdout.write(createWorkspaceManager(roots).resolveInstanceNamespace());' "$1"
}
NS_A="$(ns_for "$DATA_ROOT_A")"
NS_B="$(ns_for "$DATA_ROOT_B")"
[ -n "$NS_A" ] && [ "$NS_A" != "$NS_B" ] || { echo "FAIL: 两 data root 应得不同 namespace"; exit 1; }
ATT_A="aaaaaaaa-1111-4111-8111-111111111111"; ATT_B="bbbbbbbb-2222-4222-8222-222222222222"
PGA="cecelia-pg-$ATT_A"; PGB="cecelia-pg-$ATT_B"
CREATED_CONTAINERS="$CREATED_CONTAINERS $PGA $PGB"
docker run -d --name "$PGA" --label "cecelia.fleet.resource=postgres" --label "cecelia.fleet.attempt_id=$ATT_A" --label "cecelia.fleet.instance=$NS_A" -e POSTGRES_PASSWORD=x "$PGIMG" >/dev/null
docker run -d --name "$PGB" --label "cecelia.fleet.resource=postgres" --label "cecelia.fleet.attempt_id=$ATT_B" --label "cecelia.fleet.instance=$NS_B" -e POSTGRES_PASSWORD=x "$PGIMG" >/dev/null
# Worker-A reconcile（retained 空）：应只回收自己 namespace 的 ATT_A，绝不碰 ATT_B
node -e '
const {createAttemptResourceManager}=require("./packages/brain/scripts/fleet-worker/attempt-resources.cjs");
const {execFile}=require("node:child_process");const {promisify}=require("node:util");const run=promisify(execFile);
const runCommand=async(c,a)=>({stdout:(await run(c,a,{encoding:"utf8",maxBuffer:8<<20})).stdout.trim()});
const m=createAttemptResourceManager({runCommand,instanceNamespace:process.argv[1],postgresImageDigest:"postgres:16-alpine@sha256:"+"f".repeat(64)});
m.reconcile({retainedAttemptIds:[]}).then(r=>{console.log("removed="+JSON.stringify(r.removed_attempts));if(r.removed_attempts.includes(process.argv[2])){console.error("FAIL: 误删 Worker-B");process.exit(1);}}).catch(e=>{console.error("FAIL",e.message);process.exit(1);});
' "$NS_A" "$ATT_B"
docker inspect "$PGB" >/dev/null 2>&1 || { echo "FAIL: 场景A Worker-B 容器被互杀"; exit 1; }
echo "OK 场景A Worker-B 存活"

# ============ 场景 B：namespace 重启稳定 + 旧无 namespace fail-closed ============
NS_A2="$(ns_for "$DATA_ROOT_A")"   # 同 data root 再取（模拟重启）
[ "$NS_A" = "$NS_A2" ] || { echo "FAIL: 重启后 namespace 变了 $NS_A vs $NS_A2"; exit 1; }
OLD="cccccccc-3333-4333-8333-333333333333"; PGOLD="cecelia-pg-$OLD"
CREATED_CONTAINERS="$CREATED_CONTAINERS $PGOLD"
docker run -d --name "$PGOLD" --label "cecelia.fleet.resource=postgres" --label "cecelia.fleet.attempt_id=$OLD" -e POSTGRES_PASSWORD=x "$PGIMG" >/dev/null   # 无 instance 标签 = 旧容器
node -e '
const {createAttemptResourceManager}=require("./packages/brain/scripts/fleet-worker/attempt-resources.cjs");
const {execFile}=require("node:child_process");const {promisify}=require("node:util");const run=promisify(execFile);
const runCommand=async(c,a)=>({stdout:(await run(c,a,{encoding:"utf8",maxBuffer:8<<20})).stdout.trim()});
const m=createAttemptResourceManager({runCommand,instanceNamespace:process.argv[1],postgresImageDigest:"postgres:16-alpine@sha256:"+"f".repeat(64)});
m.reconcile({retainedAttemptIds:[]}).then(r=>{if(r.removed_attempts.includes(process.argv[2])){console.error("FAIL: 删了旧无namespace容器");process.exit(1);}if(!Array.isArray(r.fail_closed)||!r.fail_closed.includes(process.argv[2])){console.error("FAIL: 无 fail_closed 告警");process.exit(1);}console.log("OK fail_closed");}).catch(e=>{console.error("FAIL",e.message);process.exit(1);});
' "$NS_A" "$OLD"
docker inspect "$PGOLD" >/dev/null 2>&1 || { echo "FAIL: 场景B 旧容器被误删（应 fail-closed）"; exit 1; }
echo "OK 场景B namespace 稳定 + 旧容器 fail-closed"

# ============ 场景 C：expired attempt 一次事务终态化 + lineage + 幂等（真 PG，禁 mock DB 边）============
# 真代码路径 = reconcileExpiredKernelAttempt（watchdog）/ controller 编排，非 kernel-stale-attempt-reconcile.mjs
# （后者只产 repair 提案，不建 replacement）。真 PG oracle 落 PG 集成测试（自建库 + 真 migrate，
# 驱动真实终态化+lineage+幂等代码，无 DB mock），brain-integration job 与本 E2E 均可跑。
( cd "$BRAIN_DIR" \
  && NODE_ENV=test DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_USER="$DB_USER" DB_PASSWORD="$DB_PASSWORD" \
     npx vitest run --config vitest.integration.config.js \
       src/__tests__/integration/kernel-instance-fencing-lineage.pg.integration.test.js ) \
  || { echo "FAIL: 场景C PG 集成测试未过（终态化/lineage/幂等）"; exit 1; }
echo "OK 场景C 终态化+restart_reason lineage+幂等（真 PG 集成测试通过）"

echo "✅ Fleet Worker 实例互杀防护 + quarantined 闭环 Golden Path 全场景验证通过"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `resolveInstanceNamespace` 传只读/不可写 data root（chmod 000）→ 应 fail-closed 报错而非静默生成临时 namespace
- 重复提交: 同一 expired parent 并发两个 reconcile 进程（后台 `&` 同时起两个 `kernel-stale-attempt-reconcile.mjs`）→ 唯一约束应让其中一个 deduped，最终仍只 1 个 child
- 中途中断: reconcile 终态化事务中途 kill 进程 → 重跑后 parent 要么仍 active 要么 failed+child，禁止出现 parent=failed 但无 child 的半开态
- 边界值: instance 标签存在但值为空串 `cecelia.fleet.instance=` → 按旧容器 fail-closed 处理，不得当作"匹配任意 namespace"
发现分级: P0/P1（跨实例误删 / 误终态化活跃 attempt / lineage 断裂）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| namespace 生成/持久化/重启稳定 | `sprints/08132138-fleet-worker-instance-fencing/tests/instance-fencing.test.ts` | `namespace 持久化到 data root 且重启稳定` | → FAIL（resolveInstanceNamespace 未实现） |
| reconcile 实例隔离 | 同上 | `reconcile 不跨实例删除他 namespace 容器` | → FAIL（reconcile 无 namespace 维度） |
| 旧无 namespace fail-closed | 同上 | `旧无 namespace 容器 fail-closed 不删` | → FAIL（无 fail_closed 信号） |
| contract→runtime 投影 | 同上 | `contract_requirements.postgres 投影 runtime_resources.postgres` | → FAIL（projectContractRequirements 未导出） |
| expired 终态化+lineage+幂等（真 PG） | `packages/brain/src/__tests__/integration/kernel-instance-fencing-lineage.pg.integration.test.js` | `expired attempt 终态化为 failed 且 replacement 记录 restart_reason lineage` / `重复 reconcile 幂等不再生 replacement` | → FAIL（lineage/幂等未落地） |
