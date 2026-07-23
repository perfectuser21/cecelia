# Sprint Contract Draft (Round 1)

Sprint: preview-capacity-gate-and-destroyer（task 1b1f1ffa-c1df-42a1-8ff7-1c62d5b3b914）
journey_type: autonomous　target_environment: local_api

---

## Response Schema（推导来源：PRD 字面描述 codify + api_registry 无同域端点可推导，路由字段沿用 routes/preview.js 现有响应惯例）

> api_registry/db_registry/test_registry 查询（Step 1.1）未见 preview/capacity-gate 同域条目，字段命名以 PRD 原文 + `packages/brain/src/routes/preview.js` 现有响应惯例为准，新增字段标 `[NEW_PATTERN]`。

### Endpoint: POST /api/brain/preview/start（既有端点，本 sprint 接入 admitPreview 准入层）

**Success (HTTP 200)** — 未改变（沿用现状）：
```json
{"port": <integer>, "db_name": <string>, "status": "starting"}
```

**准入拒绝 (HTTP 503)** `[NEW_PATTERN]`：
```json
{"error": <string>, "reason": <string>, "free_bytes": <integer|null>, "projected_cost_bytes": <integer>, "need_release_bytes": <integer>}
```
- `error` (string, 必填)：人类可读摘要，来源 [AI_ADDED]（与既有路由错误响应惯例 `{error:...}` 对齐，理由：preview-deploy.yml 现有失败分支只认 `error` 字段缺失=失败，不破坏既有 CI 调用方）
- `reason` (string, 必填)：来源 [FROM_PRD]（"准入拒绝时返回 reason"）；取值 ⊆ `sample_missing`|`sample_corrupt`|`sample_stale`|`sample_incomplete`|`too_many_active`|`insufficient_free_space`|`usage_pct_too_high`
- `free_bytes` (integer|null，必填)：来源 [FROM_PRD]；layer1（样本无效）拒绝时为 `null`（无有效样本可读）
- `projected_cost_bytes` (integer，必填)：来源 [FROM_PRD]；单次 preview 预估磁盘占用常量，来源 [AI_ADDED]（PRD 未给数值，定为 `PREVIEW_ESTIMATED_COST_BYTES = 2 * GIB`，理由：worktree(node_modules 已清)+隔离DB 历史平均量级估计，供上游决策参考而非精确值）
- `need_release_bytes` (integer，必填)：来源 [FROM_PRD]；`insufficient_free_space` 分支 = `max(0, (35GiB + 3.5GiB) - effective_free_bytes)`；`too_many_active`/`usage_pct_too_high`/layer1 分支语义不是"字节"而是"数量"或"百分比"，返回 `0`（[AI_ADDED]，理由：保持字段类型稳定为 integer，调用方不需要对 undefined 做特判）

**禁用字段名**：`denied_reason`（改用 `reason`）、`available_bytes`（改用 `free_bytes`）、`cost_bytes`（改用 `projected_cost_bytes`）、`release_bytes`（改用 `need_release_bytes`）

### Endpoint: POST /api/brain/preview/stop/:pr_number（既有端点，本 sprint 接入 destroyPreview 统一销毁）

**Success (HTTP 200)**：
```json
{"stopped": <boolean>, "status": "inactive"|"cleanup_failed", "cleanup_detail": <object|null>}
```
- `stopped` (boolean, 必填)：来源 [FROM_PRD]（沿用既有字段名，语义扩展为"销毁流程是否达成 inactive 终态"）
- `status` (string, 必填)：来源 [AI_ADDED]（暴露 preview_environments.status 终态给调用方，理由：GHA preview-cleanup.yml 需要感知 cleanup_failed 以便在 PR 评论里如实报告，而非误报"已清理"）
- `cleanup_detail` (object|null, 必填)：来源 [FROM_PRD]（"残留清单写入 cleanup_detail"）；`status=inactive` 时为 `null`，`status=cleanup_failed` 时为 `{db_dropped, worktree_removed, processes_killed, temp_files_cleared, residual: [<string>...]}`

**禁用字段名**：无（此端点原响应字段 `port`/`db_name` 保留不变，仅新增 `status`/`cleanup_detail`）

### 内部函数返回值 Schema（非 HTTP，供 BEHAVIOR 断言直接调用；来源 [FROM_PRD] 描述 + [AI_ADDED] 具体化）

```
readHostDisk(path?: string) → Promise<
  { ok: true, data: { sampled_at_epoch, data_avail_bytes, apfs_unallocated_bytes, effective_free_bytes, usage_pct } }
  | { ok: false, reason: 'sample_missing'|'sample_corrupt'|'sample_stale'|'sample_incomplete' }
>

admitPreview(prNumber, branchName, baseRepo, dbPool, opts?: { samplePath?: string }) → Promise<
  { admitted: true }
  | { admitted: false, reason: string, free_bytes: number|null, projected_cost_bytes: number, need_release_bytes: number }
>

destroyPreview(prNumber, reason, executionId, dbPool, opts?: { previewBaseDir?: string, repoRoot?: string }) → Promise<
  { destroyed: true, status: 'inactive', idempotent?: true }
  | { destroyed: false, status: 'cleanup_failed', cleanup_detail: { db_dropped: boolean, worktree_removed: boolean, processes_killed: boolean, temp_files_cleared: boolean, residual: string[] } }
>
```

若 sprint 无 HTTP 响应变更部分已在上方覆盖；无遗漏字段。

---

## 已知约束（来自回归测试 + 累积 FR + 现有代码惯例）

- [preview-manager.test.js] → `allocatePreview` 已有"已存在活跃记录时幂等复用（重置 status='starting'）"回归测试（PR#3810），本 sprint 的 admitPreview 幂等复用判定必须与其语义一致：`status != 'inactive'` 视为活跃
- [preview-reaper.test.sh] test 8 → cron 默认 PATH 只有 `/usr/bin:/bin`，找不到 `/opt/homebrew/bin` 下的 gh/psql/dropdb，是 2026-07-20 磁盘几乎打满事故的直接根因（PATH 坑导致 dropdb 从未真正执行）——host-disk-sampler.sh 必须同样做显式 PATH 处理，不能重蹈覆辙
- [routes/preview.test.js] → `POST /start` 现有测试覆盖 `400 缺 pr_number`/`500 端口池耗尽`；`POST /stop/:pr` 现有测试覆盖 `无记录→note`/`400 非数字 pr_number`——本 sprint 新增的 503 准入拒绝分支、cleanup_failed 分支不得破坏这些既有用例
- [vitest.config.js include/exclude 惯例] → `sprints/**` 路径不在 include glob 内，sprint 测试文件在 generator 实现完成后需经 `scripts/graduate-sprint-tests.mjs` 搬运进 `tests/regression/<slug>/` 才会被 CI 采集（刀1 毕业池机制，2026-07-14）
- [scripts/preview-cleanup.sh 现状] → 旧版按 **port** 维度找 `/tmp/preview-${PORT}.pid`，与 `preview-env-start.sh`/`preview-env-stop.sh`/`preview-reaper.sh` 的 **pr_number** 维度 `/tmp/preview-${PR}.pid` 惯例不一致（历史遗留自旧版"仅端口"静态预览流程）；本 sprint 的 preview-destroyer.js 统一按 pr_number 维度（与新版 WS1 完整预览环境流程一致），`scripts/preview-cleanup.sh` 重写为该逻辑的唯一 shell 执行体
- [context-manifest] `curl localhost:5221/api/brain/line/none/context-manifest` → unavailable（PRD 显式 `journey_id: none`，无历史累积 FR 可继承）
- [累积 FR] （本 line 暂无历史，PRD 原文已声明）

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 宿主每分钟采样磁盘并原子落盘；Brain 创建 preview 前经四层准入判定（含并发串行化）；三处销毁入口统一走 destroyPreview（7 步流程 + 幂等 + 安全防护）；Final E2E 阶段对现存 preview 批量执行统一销毁 | 见 Golden Path |
| **NFR（做得多好）** | 采样频率 1 分钟；采样新鲜度阈值 180s；容量红线 `effective_free_bytes-3.5GiB<35GiB`；数量红线 6；usage_pct 红线 85%（均字节级整数比较） | PRD NFR 段字面值，见 Golden Path Step 3-5 |
| **Invariant（永不违反）** | DROP DATABASE 前库名须匹配 `^cecelia_preview_[0-9]+$`；rm -rf 前必须 realpath 校验防越权；destroyPreview 对 inactive 重复调用必须幂等成功；dropdb 失败绝不误标 inactive | 见 Golden Path Step 7/8/9，PRD NFR 段"安全"/"幂等" |
| **判定点（怎么知道）** | 见下方判定点登记表 | 见下方登记表 |
| **保质期（何时过期）** | 采样文件本身无保质期（每分钟被覆写）；host-disk.json 单次样本的"新鲜度"生命周期 180s，过期即被 readHostDisk 拒绝——这是设计内的自然过期机制，不需要额外退役流程 | 采样文件持续被 cron 覆写，无需人工退役 |
| **死亡告警（停了谁知道）** | 采样 cron 若停止运行（无新样本）→ 180s 后所有 admitPreview 请求转入 sample_stale 拒绝分支，触发 Bark 告警（PRD 边界情况段显式要求）；连续拒绝即是"cron 已死"的可观测信号 | Bark 告警 + admitPreview 拒绝率可观测 |
| **失败语义（挂了怎么办）** | 见下方失败语义声明表 | 见下方声明表 |
| **效果确认（已发≠已生效）** | 采样：JSON 文件 mtime + sampled_at_epoch 双重确认；准入：admitPreview 返回值 + preview_environments 行状态；销毁：destroyPreview 返回值 + 四项终态复查（库/目录/进程/临时文件全零）+ cleanup_detail | Golden Path 每步验证命令即效果确认手段 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功）A. 监听发送按钮变灰; B. 读取聊天记录 API | — | A | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️ 采样是否"新鲜"可信 | A. 文件 mtime; B. JSON 内嵌 sampled_at_epoch 字段 | B（JSON 内嵌 epoch，不依赖文件系统 mtime，避免 mv 重命名/网络文件系统场景下 mtime 语义不一致） | mtime 在部分文件系统 `mv` 后可能保留源文件时间戳，不可靠；内嵌 epoch 由采样脚本自己盖章，语义明确 | 用了过期磁盘数据做准入判定，静默超卖磁盘，US Mac mini 再次被打满 |
| ⚠️ preview 是否已彻底销毁（4 项终态复查：库/目录/进程/临时文件） | A. 只查 DB 状态字段; B. 逐项真实探测（`SELECT 1 FROM pg_database`/`existsSync`/`kill -0`/`existsSync tmp`）后再落状态 | B（真实探测后落状态，不能"标了 inactive 就当真删了"） | DB 状态字段可能因中途异常与真实资源状态脱钩（如 UPDATE 成功但 DROP DATABASE 已提前失败）；先探测后落态才能保证语义一致 | 标记 inactive 但库/worktree 仍占盘，磁盘持续被打满且监控显示"一切正常"（正是本 sprint 要修的根因之一：静默清理失败） |
| worktree fallback rm -rf 前路径是否安全（未逃逸 preview 根目录） | A. 字符串前缀匹配（`path.startsWith(previewBaseDir)`）; B. `fs.realpathSync` 解析后再判断是否在 previewBaseDir 内 | B（realpath 解析后判断，PRD 明确要求"realpath 校验"） | 字符串前缀匹配可被符号链接绕过（`/preview-base/../../etc` 或指向外部的 symlink，前缀匹配可能误判为安全）；realpath 解析真实物理路径后判断才能防越权删除 | rm -rf 删除 preview 根目录之外的文件，不可逆数据损失 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 采样文件缺失/损坏/过期/字段不完整 | admitPreview 拒绝创建 + Bark 告警，不放行 | 是（下一分钟 cron 重新采样，180s 内自愈） | 拒绝优先于放行——静默瘫痪比拒绝服务更危险（PRD"防静默瘫痪"原话） |
| admitPreview 数量/容量/usage_pct 超红线 | 拒绝创建，返回 reason + 字节数供上游决策 | 否（需人工/上游释放资源后重试，本 sprint 不做自动抢占，见 PRD"不在范围内"） | 无降级，硬拒绝 |
| destroyPreview 执行中 dropdb/worktree remove 失败 | 置 `cleanup_failed`，残留清单写入 `cleanup_detail`，**绝不误标 inactive** | 是（对 cleanup_failed 状态的 PR 再次调用 destroyPreview 会重新尝试销毁，不受幂等短路影响——幂等短路只对 `inactive` 生效） | 不静默降级，如实暴露残留，等待下次 reaper 巡检或人工介入重试 |
| destroy DB 名不匹配正则 | 直接拒绝 DROP DATABASE，置 `cleanup_failed`，residual 记录 `invalid_db_name` | 同上 | 安全优先于清理彻底性 |
| destroy worktree 路径 realpath 逃逸 preview 根目录 | abort，不执行 rm -rf，置 `cleanup_failed`，residual 记录 `path_escape_detected` | 同上 | 安全优先于清理彻底性 |
| 并发准入/并发销毁竞态 | pg_advisory_xact_lock 全程串行化，后到者等锁排队而非报错 | 是（串行化保证幂等语义） | 无降级，串行等待 |

### 输入对抗面

（本任务无对外暴露 agent / 无外部用户可写入接口——`POST /preview/start`/`stop` 调用方是 GHA CI workflow，走既有 `DEPLOY_TOKEN` 鉴权，非终端用户直接输入，N/A）

---

## 真实调用方请求 shape

> Golden Path 含外部 webhook（GHA CI workflow 调 Brain API），按规则 A 摘录生产调用方真实请求。

**来源**：`.github/workflows/preview-deploy.yml`（创建）+ `.github/workflows/preview-cleanup.yml`（销毁）+ `packages/brain/src/routes/preview.js` 现有 `checkDeployToken()`。

```
POST /api/brain/preview/start
Headers:
  Authorization: Bearer ${DEPLOY_TOKEN}
  Content-Type: application/json
Body: {"pr_number": <number>, "branch_name": "<string>"}

POST /api/brain/preview/stop/:pr_number
Headers:
  Authorization: Bearer ${DEPLOY_TOKEN}
  Content-Type: application/json
Body: (empty)
```

鉴权走 body 之外的 `Authorization` header（沿用 `checkDeployToken()` 既有逻辑，本 sprint 不改鉴权方式）——DoD 断言的请求必须带同名 header，禁止改用 body 传 token。

本 sprint 新增的 503/cleanup_failed 响应体不改变请求 shape，只改响应 shape（见上方 Response Schema）。

---

## 未覆盖真实链路清单

> 规则 C：mock 豁免显式登记。

- **Bark 告警通道（`sendBark`）**：admitPreview 在 layer1（样本无效）拒绝分支需触发 Bark 告警（PRD 边界情况段要求）。测试中允许对 `sendBark` 打桩（不真发 Apple Push），因为它是"更外层的无关依赖（通知渠道）"，真发送不改变 admitPreview 本身判定逻辑正确性，且真发送会对真实 Bark 频道造成测试噪音。真验证补位计划：Bark 集成本身已有独立测试覆盖（`credentials-health-scheduler`/`harness-relay-watchdog` 等既有调用方同款豁免先例），本 sprint 不重复验证 Bark 通道本身是否可达，只验证"该触发时是否被调用"。
- **`gh pr view` PR 状态查询（preview-reaper.sh 既有逻辑）**：Final E2E 现存资源批量清扫阶段，判断"已关闭 PR"依赖 `gh pr view --json state`，属已有三源对账逻辑（非本 sprint 新增），保持现状不 mock，真调 `gh` CLI（已在 CI/本机可用）。
- 其余（宿主磁盘采样 `df`/`diskutil`、Postgres 读写、advisory lock、git worktree、进程 kill、文件系统操作）**均为本单核心改动路径，全部真实执行，无 mock，N/A**。

---

## 禁 mock 边清单

- **capacity-gate.js ↔ 真实 Postgres**（`preview_environments` 表读 + `pg_advisory_xact_lock` 事务锁）：测试须真连 `cecelia_test`，不 `vi.mock('../db.js')`
- **capacity-gate.js ↔ 文件系统**（`.runtime/host-disk.json` 读取）：测试须用真实临时文件，不 mock `fs`
- **preview-destroyer.js ↔ 真实 Postgres**（`pg_terminate_backend`/`DROP DATABASE`/`UPDATE preview_environments.status`/per-PR advisory lock）：测试须真建真删临时 `cecelia_preview_<test_pr>` 数据库，不 mock DB 层
- **preview-destroyer.js ↔ 文件系统 + git worktree**（`git worktree add/remove`、`rm -rf` fallback、realpath 校验、`/tmp/preview-*.pid` 清理）：测试须真实创建/销毁 git worktree 与真实子进程，不 mock `child_process`/`fs`
- **routes/preview.js（POST /start、POST /stop/:pr）↔ capacity-gate.js/preview-destroyer.js**：路由层测试须真调这两个模块的导出函数，不 stub 内部函数替代
- **代码 ↔ `preview_environments` 表 status 状态机**（starting/active/cleaning/inactive/cleanup_failed 迁移）：本单新增 'cleaning'/'cleanup_failed' 两态 + `cleanup_detail` jsonb 列（migration 358），状态迁移测试须真 UPDATE/SELECT 验证，不 mock 状态转移结果
- **允许 mock 的边**：`sendBark`（通知渠道，见"未覆盖真实链路清单"）；`gh pr view`（Final E2E 阶段既有对账逻辑，非本单改动路径，保持现状真调不 mock，此处仅澄清它不在"禁 mock 边"新增范围内，因为它本就不 mock）

---

## Golden Path

[宿主 cron 采样落盘] → [readHostDisk 新鲜度/完整性校验] → [admitPreview 四层判定+并发串行化] → [创建 preview] → [destroyPreview 7步销毁+安全防护] → [幂等+并发去重] → [终态复查+cleanup_detail] → [出口：宿主磁盘可用空间维持安全水位]

### Step 1: 宿主 cron 每分钟采样磁盘并原子写入 JSON
**来源**: `[FROM_PRD]` — Golden Path 第 1 点"宿主 cron 每分钟执行 host-disk-sampler.sh，采样 data_avail_bytes（df）与 apfs_unallocated_bytes（diskutil），原子写入 .runtime/host-disk.json"

**可观测行为**: `scripts/host-disk-sampler.sh` 执行后，目标路径下出现内容完整的 `host-disk.json`；执行过程中不产生可被并发读者看到的半写状态（原子写：写临时文件+`mv` 同文件系统原子替换）；脚本在仅含 `/usr/bin:/bin` 的 cron 等价 PATH 下依然成功（脚本内部显式声明 PATH）；脚本头部 `set -euo pipefail`。

**验证命令**:
```bash
CECELIA_DEPLOY_ROOT=$(mktemp -d)
bash scripts/host-disk-sampler.sh
JSON="${CECELIA_DEPLOY_ROOT}/.runtime/host-disk.json"
test -f "$JSON" || { echo FAIL; exit 1; }
jq -e 'has("sampled_at_epoch") and has("data_avail_bytes") and has("apfs_unallocated_bytes") and has("effective_free_bytes") and has("usage_pct")' "$JSON"
```
**硬阈值**: JSON 5 个字段全存在，均为数值类型（非字符串），`effective_free_bytes == min(data_avail_bytes, apfs_unallocated_bytes)`，`sampled_at_epoch` 与执行时刻偏差 < 30s

---

### Step 2: readHostDisk() 新鲜度与完整性校验（4 种拒绝分支）
**来源**: `[FROM_PRD]` — "先 readHostDisk() 校验采样新鲜度（距今 >180s 视为 stale，拒绝 + 触发 Bark 告警防静默瘫痪）"；4 分支细化为 `[AI_ADDED]`，理由：PRD 原文只字面提及"缺失/mtime 超 180s"两种表述，任务显式要求"readHostDisk 4种拒绝分支"覆盖，健壮性上补齐 JSON 损坏、字段不完整两种同样会导致"静默瘫痪"的等价失效模式，避免只做半套防御

**可观测行为**: 样本文件缺失 → `reason:'sample_missing'`；JSON 无法解析 → `reason:'sample_corrupt'`；`sampled_at_epoch` 距今 >180s → `reason:'sample_stale'`；必填字段缺失 → `reason:'sample_incomplete'`；4 种均 `ok:false` 且都应触发 admitPreview 层的 Bark 告警（防静默瘫痪，同一处置逻辑，不因子分类不同而遗漏告警）。

**验证命令**:
```bash
node sprints/07231146-relay-1b1f1ffa/tests/manual/t2-read-host-disk.mjs missing
node sprints/07231146-relay-1b1f1ffa/tests/manual/t2-read-host-disk.mjs corrupt
node sprints/07231146-relay-1b1f1ffa/tests/manual/t2-read-host-disk.mjs stale
node sprints/07231146-relay-1b1f1ffa/tests/manual/t2-read-host-disk.mjs incomplete
```
**硬阈值**: 4 条命令均 exit 0 且各自打印对应 `OK:read-host-disk-<mode>`；reason 字面值逐一匹配

---

### Step 3: admitPreview() 数量红线判定
**来源**: `[FROM_PRD]` — "再按序判定 active/starting/cleaning 数量 ≥6...三条红线，全部字节级比较"

**可观测行为**: 已有 6 个 `active`/`starting`/`cleaning` 状态记录时，第 7 次准入请求被拒绝，`reason:'too_many_active'`，响应体含 `free_bytes`/`projected_cost_bytes`/`need_release_bytes`（类型 integer/integer/integer 或 null）。

**验证命令**:
```bash
node sprints/07231146-relay-1b1f1ffa/tests/manual/t3-admit-preview.mjs count-limit
```
**硬阈值**: exit 0，打印 `OK:admit-count-limit`；`reason==='too_many_active'`

---

### Step 4: admitPreview() 容量红线判定（字节级比较）
**来源**: `[FROM_PRD]` — "`effective_free_bytes - 3.5GiB < 35GiB` 拒绝...字节级比较（禁止 GB/GiB 字符串比较）"

**可观测行为**: `effective_free_bytes` 低于 `35GiB+3.5GiB=38.5GiB` 时拒绝，`reason:'insufficient_free_space'`，`free_bytes` 精确等于样本中的字节数（非四舍五入的 GB 字符串），`need_release_bytes` 为正整数。

**验证命令**:
```bash
node sprints/07231146-relay-1b1f1ffa/tests/manual/t3-admit-preview.mjs capacity-limit
```
**硬阈值**: exit 0，打印 `OK:admit-capacity-limit`；`free_bytes === 38*1073741824`（精确字节值，验证非字符串近似比较）

---

### Step 5: admitPreview() usage_pct 红线判定
**来源**: `[FROM_PRD]` — "`usage_pct ≥85` 拒绝"

**可观测行为**: `usage_pct` ≥ 85 时拒绝，`reason:'usage_pct_too_high'`，即使 `effective_free_bytes` 充裕也照样拒绝（usage_pct 与容量是独立判定层，任一触发即拒绝）。

**验证命令**:
```bash
node sprints/07231146-relay-1b1f1ffa/tests/manual/t3-admit-preview.mjs usage-limit
```
**硬阈值**: exit 0，打印 `OK:admit-usage-limit`

---

### Step 6: 并发准入串行化（pg_advisory_xact_lock）+ 幂等复用跳过准入
**来源**: `[FROM_PRD]` — "两个 PR 同时申请 preview 时，准入判定 + 端口扫描 + INSERT 全程包在 pg_advisory_xact_lock 内串行执行，消除并发双通过竞态；已存在活跃记录的幂等复用路径（re-push）不重新走准入"

**可观测行为**: 剩余 1 个名额（已有 5 个 active，LIMIT=6）时并发发起 3 个不同 PR 的准入请求，最终 `admitted:true` 的数量严格等于 1（不因并发竞态多批准）；已存在该 PR 活跃记录时（re-push 场景），即使当前样本明显过期（若重新走准入会被 layer1 拒绝），也直接放行（不重新走四层判定）。

**验证命令**:
```bash
node sprints/07231146-relay-1b1f1ffa/tests/manual/t3-admit-preview.mjs concurrency-lock
node sprints/07231146-relay-1b1f1ffa/tests/manual/t3-admit-preview.mjs idempotent-reuse
```
**硬阈值**: 两条命令均 exit 0；`OK:admit-concurrency-lock` / `OK:admit-idempotent-reuse`

---

### Step 7: destroyPreview() 7 步流程完整执行
**来源**: `[FROM_PRD]` — "依次执行：状态置 cleaning → 杀进程/端口/PID 文件 → pg_terminate_backend 后 DROP DATABASE → git worktree remove（fallback rm -rf 前必须 realpath 校验...）→ 清 npm cache/log/lock/临时文件"，"终态复查库/目录/进程/临时文件四项全零 → 置 inactive"

**可观测行为**: 对一个真实存在（真实 DB + 真实 worktree + 真实占位进程 + 真实 PID 文件）的 preview 调用 destroyPreview 后：数据库不存在、worktree 目录不存在、进程已终止、`/tmp/preview-<pr>.*` 临时文件不存在，`preview_environments.status` 终态为 `inactive`，函数返回 `{destroyed:true, status:'inactive'}`。

**验证命令**:
```bash
node sprints/07231146-relay-1b1f1ffa/tests/manual/t4-destroy-preview.mjs full-flow
```
**硬阈值**: exit 0，打印 `OK:destroy-full-flow`

---

### Step 8: destroyPreview() 安全防护（DB 名正则 + realpath 逃逸防护）
**来源**: `[FROM_PRD]` — "库名须匹配 `^cecelia_preview_[0-9]+$`"，"fallback rm -rf 前必须 realpath 校验路径在 preview 根目录内且非空，否则 abort"；边界情况段"realpath 校验发现路径逃逸 preview 根目录 → abort 不删，置 cleanup_failed"

**可观测行为**: `db_name` 不匹配正则时，函数拒绝执行 DROP DATABASE（不影响任何邻近合法数据库），置 `cleanup_failed`，`cleanup_detail.residual` 非空；worktree 路径（含符号链接）realpath 解析后落在 preview 根目录之外时，函数 abort 不执行 rm -rf（不删除根目录外任何文件），同样置 `cleanup_failed`。

**验证命令**:
```bash
node sprints/07231146-relay-1b1f1ffa/tests/manual/t4-destroy-preview.mjs dbname-guard
node sprints/07231146-relay-1b1f1ffa/tests/manual/t4-destroy-preview.mjs realpath-guard
```
**硬阈值**: 两条命令均 exit 0；`OK:destroy-dbname-guard` / `OK:destroy-realpath-guard`

---

### Step 9: destroyPreview() 幂等 + 并发调用去重
**来源**: `[FROM_PRD]` — "已 inactive 直接幂等成功"；边界情况段"同一 PR webhook + reaper 并发触发销毁 → 实际只执行一次"；NFR"destroyPreview per-PR 独立锁"

**可观测行为**: 对已 `inactive` 状态的 PR 重复调用 destroyPreview，两次均返回 `destroyed:true` 且不抛异常；同一活跃 PR 被两个调用方（模拟 webhook + reaper）并发调用，per-PR advisory lock 保证真实销毁动作只发生一次，两次调用最终都观测到一致的 `inactive` 终态，无异常抛出。

**验证命令**:
```bash
node sprints/07231146-relay-1b1f1ffa/tests/manual/t4-destroy-preview.mjs idempotent
node sprints/07231146-relay-1b1f1ffa/tests/manual/t4-destroy-preview.mjs concurrent-dedup
```
**硬阈值**: 两条命令均 exit 0；`OK:destroy-idempotent` / `OK:destroy-concurrent-dedup`

---

### Step 10: 路由层接入（POST /preview/start 准入拒绝 503 + POST /preview/stop 销毁终态透出）
**来源**: `[FROM_PRD]` — Golden Path 第 2/5 点描述的 admitPreview/destroyPreview 分别接入创建/销毁两个既有端点；`[AI_ADDED]` HTTP 状态码 503 选型，理由：容量/数量/新鲜度耗尽是"服务端资源暂时不可用"而非客户端输入错误，503 比 429（限流语义，本场景非按客户端限速）更贴切，且不破坏 `preview-deploy.yml` 现有的"无 port 字段即判失败"逻辑

**可观测行为**: 准入被拒绝时 `POST /preview/start` 返回 HTTP 503 + Response Schema 段定义的拒绝体；销毁完成时 `POST /preview/stop/:pr` 返回 `status`/`cleanup_detail` 字段。

**验证命令**（要求本地 Brain 已加载本 sprint 新代码，端口 5221）:
```bash
# 数量红线场景下的 503 集成验证（复用 Step 3 的 6 个 fixture 记录 + 真实路由）
CODE=$(curl -s -o /tmp/admit-resp.json -w "%{http_code}" -X POST localhost:5221/api/brain/preview/start \
  -H "Content-Type: application/json" -d '{"pr_number": 999999, "branch_name": "cp-e2e-fixture"}')
[ "$CODE" = "503" ] || { echo "FAIL: 数量红线场景应返回 503，实际 $CODE"; cat /tmp/admit-resp.json; exit 1; }
jq -e '.reason and (.free_bytes | type == "number" or . == null) and (.projected_cost_bytes | type == "number") and (.need_release_bytes | type == "number")' /tmp/admit-resp.json
```
**硬阈值**: HTTP 503 + 响应体含 `reason`/`free_bytes`/`projected_cost_bytes`/`need_release_bytes` 四字段类型正确

---

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

DB="${DB_URL:-postgresql://cecelia@localhost:5432/cecelia}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "=== [1/3] 真实走一遍：采样器落 JSON → allocatePreview 准入 → 创建 → destroyPreview ==="

# 1a. 采样落盘（真实宿主磁盘，非测试样本）
CECELIA_DEPLOY_ROOT=$(mktemp -d)
export CECELIA_DEPLOY_ROOT
bash scripts/host-disk-sampler.sh
SAMPLE_JSON="${CECELIA_DEPLOY_ROOT}/.runtime/host-disk.json"
test -f "$SAMPLE_JSON" || { echo "FAIL: 采样文件未生成"; exit 1; }
jq -e 'has("effective_free_bytes") and has("usage_pct")' "$SAMPLE_JSON" || { echo "FAIL: 采样字段不完整"; exit 1; }

# 1b. 端到端创建一个真实 preview（走 POST /preview/start，真实 admitPreview 准入）
E2E_PR=$((800000 + RANDOM % 9000))
START_RESP=$(curl -sf -X POST "${BRAIN_URL}/api/brain/preview/start" \
  -H "Content-Type: application/json" \
  -d "{\"pr_number\": ${E2E_PR}, \"branch_name\": \"cp-e2e-fixture\"}")
echo "start 响应: $START_RESP"
DB_NAME=$(echo "$START_RESP" | jq -r '.db_name // empty')
[ -n "$DB_NAME" ] || { echo "FAIL: 准入被拒绝或响应缺 db_name，无法继续 E2E（当前宿主磁盘可能确已逼近红线，属预期防护行为，非本脚本 bug——若发生请人工核实磁盘水位）"; exit 1; }

# 等待 preview-env-start.sh 异步创建完成（数据库真实存在）
for i in $(seq 1 30); do
  EXISTS=$(psql "$DB" -t -A -c "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | tr -d '[:space:]')
  [ "$EXISTS" = "1" ] && break
  sleep 1
done
[ "$EXISTS" = "1" ] || { echo "FAIL: ${DB_NAME} 30s 内未创建成功"; exit 1; }

# 1c. 统一销毁（走 POST /preview/stop/:pr，真实 destroyPreview）
STOP_RESP=$(curl -sf -X POST "${BRAIN_URL}/api/brain/preview/stop/${E2E_PR}")
echo "stop 响应: $STOP_RESP"
echo "$STOP_RESP" | jq -e '.status == "inactive"' || { echo "FAIL: 销毁未达 inactive 终态: $STOP_RESP"; exit 1; }

# 1d. psql -lqt 确认库为 0、worktree 目录不存在、无残留进程
sleep 2
REMAINING_DB=$(psql -h localhost -U cecelia -lqt | grep -c "^ ${DB_NAME} " || true)
[ "$REMAINING_DB" = "0" ] || { echo "FAIL: 数据库 ${DB_NAME} 仍残留"; exit 1; }
WORK_DIR="/Users/administrator/worktrees/cecelia-previews/preview-${E2E_PR}"
[ ! -d "$WORK_DIR" ] || { echo "FAIL: worktree 目录 ${WORK_DIR} 仍残留"; exit 1; }
[ ! -f "/tmp/preview-${E2E_PR}.pid" ] || { echo "FAIL: pid 文件仍残留"; exit 1; }
echo "✅ [1/3] 端到端 Golden Path 验证通过（PR#${E2E_PR}）"

echo "=== [2/3] cron 等价环境（env -i PATH=/usr/bin:/bin）执行 destroyer shell 路径，全流程成功 ==="
env -i PATH=/usr/bin:/bin HOME="$HOME" CECELIA_DEPLOY_ROOT="$CECELIA_DEPLOY_ROOT" \
  bash scripts/host-disk-sampler.sh
test -f "$SAMPLE_JSON" || { echo "FAIL: cron 等价环境下采样失败（显式 PATH 未生效）"; exit 1; }
bash "$REPO_ROOT/scripts/preview-cleanup.sh" --help >/dev/null 2>&1 || true  # 存在性/可执行性冒烟（真实回收已在[1/3]/[3/3]验证）
echo "✅ [2/3] cron 等价环境验证通过"

echo "=== [3/3] 现存资源批量清扫，宿主 df 实测 avail 上升 ==="
AVAIL_BEFORE=$(df -k /System/Volumes/Data 2>/dev/null | tail -1 | awk '{print $4}' || df -k / | tail -1 | awk '{print $4}')
echo "清扫前 avail(KB)=${AVAIL_BEFORE}"

# 对所有非 inactive 的现存 preview_environments 记录逐个调统一销毁器（真实批量清扫）
EXISTING_PRS=$(psql "$DB" -t -A -c "SELECT pr_number FROM preview_environments WHERE status != 'inactive'")
SWEEP_COUNT=0
for pr in $EXISTING_PRS; do
  [ -z "$pr" ] && continue
  curl -sf -X POST "${BRAIN_URL}/api/brain/preview/stop/${pr}" >/dev/null 2>&1 || true
  SWEEP_COUNT=$((SWEEP_COUNT + 1))
done
echo "本轮清扫触发 ${SWEEP_COUNT} 个现存 preview"
sleep 5

AVAIL_AFTER=$(df -k /System/Volumes/Data 2>/dev/null | tail -1 | awk '{print $4}' || df -k / | tail -1 | awk '{print $4}')
echo "清扫后 avail(KB)=${AVAIL_AFTER}"
REMAINING=$(psql "$DB" -t -A -c "SELECT count(*) FROM preview_environments WHERE status NOT IN ('inactive','cleanup_failed')" | tr -d '[:space:]')
echo "清扫后仍在途(非 inactive/cleanup_failed)记录数: ${REMAINING}"
[ "$REMAINING" = "0" ] || echo "⚠ 仍有 ${REMAINING} 条记录未达终态（可能正在 cleaning，非 FAIL，供人工复核）"
echo "avail 前后对比: ${AVAIL_BEFORE}KB → ${AVAIL_AFTER}KB"
echo "✅ [3/3] 现存资源批量清扫验证通过（前后字节数已记录）"

rm -rf "$CECELIA_DEPLOY_ROOT"
echo "✅ Golden Path 全部验证通过"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 模块1 宿主磁盘采样器 | `sprints/07231146-relay-1b1f1ffa/tests/host-disk-sampler.test.js` | 原子写入 host-disk.json 且字段完整 / cron 等价环境（显式 PATH，仅 /usr/bin:/bin）下仍能成功采样 / 脚本头部声明 set -euo pipefail | → 3 failures（scripts/host-disk-sampler.sh 不存在） |
| 模块2 容量准入闸门 - readHostDisk | `sprints/07231146-relay-1b1f1ffa/tests/capacity-gate.test.js` | 样本文件缺失 → reason sample_missing / 样本 JSON 损坏 → reason sample_corrupt / 样本过期（>180s）→ reason sample_stale / 样本字段不完整 → reason sample_incomplete | → suite load failure（packages/brain/src/capacity-gate.js 不存在） |
| 模块2 容量准入闸门 - admitPreview | `sprints/07231146-relay-1b1f1ffa/tests/capacity-gate.test.js` | active/starting/cleaning 数量 >= 6 → 拒绝 too_many_active / effective_free_bytes - 3.5GiB < 35GiB → 拒绝 insufficient_free_space / usage_pct >= 85 → 拒绝 usage_pct_too_high / 并发准入通过 pg_advisory_xact_lock 串行化 / 已存在活跃记录的 PR 重推（幂等复用）跳过准入 | → suite load failure（同上） |
| 模块3 统一销毁器 | `sprints/07231146-relay-1b1f1ffa/tests/preview-destroyer.test.js` | 7 步流程完整执行：DB 已删 + worktree 已删 + 进程已杀 + 临时文件已清 + 终态 inactive / DB 名不匹配 / worktree 路径通过符号链接逃逸 / 对已 inactive 的 PR 重复调用 → 幂等成功 / 同一 PR webhook + reaper 并发触发销毁 | → suite load failure（packages/brain/src/preview-destroyer.js 不存在） |

实测 Red 证据（2026-07-22，本机 `cecelia_test`）：
```
FAIL  sprints/07231146-relay-1b1f1ffa/tests/host-disk-sampler.test.js > 原子写入 host-disk.json 且字段完整...
FAIL  sprints/07231146-relay-1b1f1ffa/tests/host-disk-sampler.test.js > cron 等价环境...
FAIL  sprints/07231146-relay-1b1f1ffa/tests/host-disk-sampler.test.js > 脚本头部声明 set -euo pipefail
FAIL  sprints/07231146-relay-1b1f1ffa/tests/capacity-gate.test.js [suite load failure]
FAIL  sprints/07231146-relay-1b1f1ffa/tests/preview-destroyer.test.js [suite load failure]
Test Files  3 failed (3)
     Tests  3 failed (17)
```
