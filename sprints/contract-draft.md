# Sprint Contract Draft (Round 1)

**Sprint**: 实测 planner/GAN 容器真实内存峰值（量到即停）
**journey_type**: autonomous
**target_environment**: local_api
**journey_id**: <未提供 payload.journey_id；归 Cecelia Harness Pipeline 线（cecelia 唯一 Line = Harness Pipeline）>

---

## 技术上下文（Step 1.1 推导）

Brain context/registry API 在本机不可达（PRD 已注明，本轮 `curl localhost:5221/api/brain/registry` 空）→ registry 为空，按 PRD 字面 + 代码 SSOT 推导，标 `[NEW_PATTERN]`。

代码 SSOT（已读）：
- planner / GAN(proposer) 以 **Docker 容器**形式执行（`packages/brain/src/docker-executor.js` → `runDocker`，镜像 `cecelia/runner:latest`，启用开关 `HARNESS_DOCKER_ENABLED=true`）。
- 容器命名 `cecelia-task-{taskId 前12}-{8hex}`（`docker-executor.js:205 containerName`）。
- planner / proposer 资源档 = `pipeline-heavy`：`--memory` cgroup 限 **2048 MB**，1 core（`packages/brain/src/spawn/middleware/resource-tier.js:26,53-54`）。注释记录 content pipeline 历史峰值 ~1100 MB，512m 会 OOM。
- 宿主 cgroup v2 提供 `memory.peak` / `memory.current`（kernel 跟踪的真实峰值，是采样的 ground-truth 源之一）。

**峰值合理区间推导**：`0 < peak_rss_mb ≤ 2048`（上界 = cgroup 限；下界 > 0 = 真有进程在跑）。

---

## Response Schema（推导来源: NEW_PATTERN — 本任务无 HTTP 响应）

**Endpoint**: N/A — 任务无 HTTP 响应。本任务的「可观测输出」是落盘 JSON 文件，文件 schema 即验证 oracle。

### 落盘文件: `${SPRINT_DIR}/container-mem-peak.json`（即 `sprints/container-mem-peak.json`）

```json
{
  "measured_at": "<ISO8601 UTC 字符串，本轮测量时间>",
  "planner": {
    "target":      "<被测容器名 cecelia-task-... 或 PID，非空字符串>",
    "interval_ms": "<int，采样间隔，必须 ≤ 1000>",
    "samples_mb":  "<number[]，每个采样点的 RSS(MB)，length ≥ 3>",
    "peak_rss_mb": "<number，== max(samples_mb)，且 0 < x ≤ 2048>",
    "status":      "complete | incomplete"
  },
  "gan": { "<与 planner 同形状，独立记录，不与 planner 混算>" }
}
```

字段来源：
- `measured_at` (string, 必填): NEW_PATTERN — 防造假新鲜度锚点（AI_ADDED）
- `planner` / `gan` (object, 必填): PRD Golden Path 步骤3「输出 planner 容器峰值与 GAN 容器峰值两个数值」「分别独立记录，不混算」
- `*.peak_rss_mb` (number, 必填): PRD 步骤3「峰值内存（MB）」
- `*.samples_mb` (number[], 必填, len≥3): PRD 边界「至少 3 个采样点」
- `*.interval_ms` (number, 必填, ≤1000): PRD 边界「采样间隔需足够密（≤1s）」
- `*.status` (string, 必填): PRD 边界「容器异常退出 → 记录最后采样值并标注 incomplete」

**禁用结构**（防 generator 偷懒把两容器混算成一个数）: 顶层**不得**出现合并的 `peak_rss_mb` / `peak`（峰值必须分别挂在 `planner` / `gan` 下）。

---

## Golden Path

[触发一次 planner 容器 + GAN/proposer 容器执行] → [运行全程持续采样各容器 RSS/cgroup 内存（≤1s 间隔、≥3 点）] → [分别记录两容器峰值(MB) 落盘，量到即停]

---

### Step 1: 触发 planner 容器 + GAN/proposer 容器执行
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤1「启动一次 planner 容器执行，随后启动一次 GAN/proposer 容器执行」

**可观测行为**: 存在两个被测目标（planner 容器、GAN 容器；容器名前缀 `cecelia-task-` 或其承载进程 PID），采样器能对各自定位并附着。

**验证命令**:
```bash
# 采样器跑完后，落盘文件里两个目标都被记录且 target 非空
jq -e '(.planner.target | type=="string" and length>0) and (.gan.target | type=="string" and length>0)' "$MEASURE_OUT"
# 期望：exit 0
```

**硬阈值**: planner 与 gan 两条 target 记录均非空。
**验证命令**: 见上（jq -e）。

---

### Step 2: 运行全程持续采样各容器内存
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤2「在每个容器运行全程持续采样其内存占用（RSS / cgroup memory.peak）」+ 边界「采样间隔 ≤1s，至少 3 个采样点」

**可观测行为**: 每个容器都有 ≥3 个采样点，采样间隔 ≤1000ms。采样数据真实落入 `samples_mb` 数组。

**验证命令**:
```bash
jq -e '(.planner.samples_mb | type=="array" and length>=3) and (.gan.samples_mb | type=="array" and length>=3)' "$MEASURE_OUT"
jq -e '(.planner.interval_ms <= 1000) and (.gan.interval_ms <= 1000)' "$MEASURE_OUT"
# 期望：两条均 exit 0
```

**硬阈值**: 每容器 samples_mb 长度 ≥ 3，interval_ms ≤ 1000。
**验证命令**: 见上（jq -e）。

---

### Step 3: 分别记录两容器峰值(MB) 落盘，量到即停
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤3「输出 planner 容器峰值内存与 GAN 容器峰值内存两个具体数值（MB），测到峰值即停止采样」+ NFR「测得的峰值数值必须落盘/可读取」

**可观测行为**: 落盘文件含 `planner.peak_rss_mb` 与 `gan.peak_rss_mb` 两个数值，均 > 0、≤ 2048（cgroup 限）。

**验证命令**:
```bash
jq -e '(.planner.peak_rss_mb | type=="number") and (.planner.peak_rss_mb > 0) and (.planner.peak_rss_mb <= 2048)' "$MEASURE_OUT"
jq -e '(.gan.peak_rss_mb | type=="number") and (.gan.peak_rss_mb > 0) and (.gan.peak_rss_mb <= 2048)' "$MEASURE_OUT"
# 期望：两条均 exit 0
```

**硬阈值**: 0 < peak_rss_mb ≤ 2048（两容器各一条）。
**验证命令**: 见上（jq -e）。

---

### Step 4: 峰值=采样最大值（采样内部一致性）
**来源**: `[AI_ADDED]` — 理由：防 generator 硬编码一个峰值数字而不真采样。强制 `peak_rss_mb == max(samples_mb)`，则伪造峰值必须同时伪造一致的 samples 数组，结合 Step 5 新鲜度，使「写死一个静态文件」无法通过。

**可观测行为**: 每容器 `peak_rss_mb` 恰好等于其 `samples_mb` 的最大值。

**验证命令**:
```bash
jq -e '.planner.peak_rss_mb == (.planner.samples_mb | max)' "$MEASURE_OUT"
jq -e '.gan.peak_rss_mb     == (.gan.samples_mb | max)'     "$MEASURE_OUT"
# 期望：两条均 exit 0
```

**硬阈值**: peak_rss_mb 严格等于 samples_mb 的 max。
**验证命令**: 见上（jq -e）。

---

### Step 5: 落盘新鲜度（防历史数据冒充）
**来源**: `[AI_ADDED]` — 理由：参照 autonomous 模板「created_at > NOW() - interval '5 minutes'」时间窗。evaluator 会先重跑采样脚本再断言，`measured_at` 必须落在重跑后的窗口内，静态提交的 JSON 会因时间戳过期而 FAIL。

**可观测行为**: 重跑采样脚本后，`measured_at` 在最近 5 分钟内。

**验证命令**:
```bash
# 评测时先重跑脚本生成新文件，再断言 measured_at 新鲜（< 5 分钟）
NOW=$(date -u +%s)
TS=$(date -u -d "$(jq -r '.measured_at' "$MEASURE_OUT")" +%s 2>/dev/null || gdate -u -d "$(jq -r '.measured_at' "$MEASURE_OUT")" +%s)
DIFF=$((NOW - TS))
[ "$DIFF" -ge 0 ] && [ "$DIFF" -le 300 ] || { echo "FAIL: measured_at 过期 ${DIFF}s（疑似历史数据冒充）"; exit 1; }
echo OK
```

**硬阈值**: 0 ≤ (now − measured_at) ≤ 300 秒。
**验证命令**: 见上。

---

### Step 6: 边界 — 独立记录 + incomplete 标注
**来源**: `[FROM_PRD]` — PRD 边界「两容器并发 → 分别独立记录，不混算」「容器异常退出 → 记录退出前最后一次采样值并标注 incomplete」

**可观测行为**: planner 与 gan 是两条独立子对象（顶层无合并峰值字段）；每条 `status` ∈ {complete, incomplete}。

**验证命令**:
```bash
# 两容器独立、不混算：顶层有 planner 和 gan，且顶层无合并的 peak 字段
jq -e 'has("planner") and has("gan") and (has("peak_rss_mb") | not) and (has("peak") | not)' "$MEASURE_OUT"
# status 枚举合法
jq -e '([.planner.status, .gan.status] | all(. == "complete" or . == "incomplete"))' "$MEASURE_OUT"
# 期望：两条均 exit 0
```

**硬阈值**: 顶层独立 planner/gan、无合并峰值；status ∈ {complete, incomplete}。
**验证命令**: 见上（jq -e）。

---

## 接缝清单（接缝 vs 逻辑断言 — 真环境炸的根因防护）

> 「这功能在哪几个点碰真实世界？」→ 只有一个真实接缝：**两个峰值数字必须来自真实的 planner / GAN 容器运行**，而不是任何替身。

| # | 断言 | 类型 | 验证位置 | done 判定 |
|---|---|---|---|---|
| 1 | 采样逻辑：读目标进程/容器内存、peak=max(samples)、≥3 点 ≤1s 间隔、两条独立记录、early-exit 标 incomplete | **逻辑** | CI/单测：把采样器指向一个**真实**的内存分配子进程（真进程真测，非 mock），断言 Step 2/3/4/6 oracle | 绿 = 真 done |
| 2 | `planner.peak_rss_mb` / `gan.peak_rss_mb` 来自**真实 planner / GAN 容器**（`cecelia-task-*`，pipeline-heavy 2048MB 限）的真运行 | **接缝** | 真目标：在一次真实 harness run（`HARNESS_DOCKER_ENABLED=true`）中对活动的 `cecelia-task-*` 容器采样，读 cgroup `memory.peak`/`memory.current` 校准 | 真目标验过才标 done；本机 docker 不可用 / 无活动 harness run 时 → 标 `logic-done-pending`，**不得标 done** |

**禁止写死环境假设值**：峰值数字、samples 数组、target 容器名一律不许硬编码兜过——必须从真实进程/容器的 cgroup 或 ps RSS 推导。接缝 #2 未在真容器上校准前，本 sprint 整体标 `logic-done-pending`。

---

## 已知约束（来自回归测试）

（关键词「内存/容器/planner/GAN」未命中既有 `*.test.ts` 回归约束；暂无已知约束）

---

## E2E 验收（最终 final-e2e 跑 — target_environment = local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 说明：本任务无 Brain HTTP 端点（measurement 任务），Golden Path 的「可观测输出」是落盘 JSON。故 oracle 锚定真实采样器产出的 `$MEASURE_OUT` 文件，而非 `localhost:5221`（这是 1:1 Golden-Path 映射优先于通用 autonomous 模板的合法情形）。接缝 #2 要求在真实容器上校准（见接缝清单）。

```bash
#!/bin/bash
set -e

export MEASURE_OUT="${SPRINT_DIR:-sprints}/container-mem-peak.json"
SAMPLER="scripts/measure/container-mem-peak.mjs"

# 0. 记录脚本启动时间（防造假：本轮产物 measured_at 必须晚于此）
SCRIPT_START=$(date -u +%s)

# 1. 真实运行采样器（脚本自身负责定位/触发被测目标并采样落盘）
#    - 真实路径（接缝 #2）：若有活动 cecelia-task-* 容器 → 采样真容器
#    - 逻辑校验路径（接缝 #1）：采样器对一个真实内存分配子进程采样（真进程真测）
node "$SAMPLER" --out "$MEASURE_OUT"
[ -f "$MEASURE_OUT" ] || { echo "FAIL: 采样器未落盘 $MEASURE_OUT"; exit 1; }

# 2. Step 1 — 两目标 target 非空
jq -e '(.planner.target|type=="string" and length>0) and (.gan.target|type=="string" and length>0)' "$MEASURE_OUT" \
  || { echo "FAIL: target 缺失"; exit 1; }

# 3. Step 2 — 各容器 ≥3 采样点、间隔 ≤1s
jq -e '(.planner.samples_mb|type=="array" and length>=3) and (.gan.samples_mb|type=="array" and length>=3)' "$MEASURE_OUT" \
  || { echo "FAIL: 采样点 < 3"; exit 1; }
jq -e '(.planner.interval_ms<=1000) and (.gan.interval_ms<=1000)' "$MEASURE_OUT" \
  || { echo "FAIL: 采样间隔 > 1s"; exit 1; }

# 4. Step 3 — 两峰值 > 0 且 ≤ 2048（cgroup 限）
jq -e '(.planner.peak_rss_mb|type=="number") and (.planner.peak_rss_mb>0) and (.planner.peak_rss_mb<=2048)' "$MEASURE_OUT" \
  || { echo "FAIL: planner 峰值非法"; exit 1; }
jq -e '(.gan.peak_rss_mb|type=="number") and (.gan.peak_rss_mb>0) and (.gan.peak_rss_mb<=2048)' "$MEASURE_OUT" \
  || { echo "FAIL: gan 峰值非法"; exit 1; }

# 5. Step 4 — 峰值 == 采样最大值（防硬编码）
jq -e '.planner.peak_rss_mb == (.planner.samples_mb|max)' "$MEASURE_OUT" || { echo "FAIL: planner peak≠max(samples)"; exit 1; }
jq -e '.gan.peak_rss_mb     == (.gan.samples_mb|max)'     "$MEASURE_OUT" || { echo "FAIL: gan peak≠max(samples)"; exit 1; }

# 6. Step 5 — measured_at 新鲜（本轮重跑产出，防历史冒充）
TS=$(date -u -d "$(jq -r '.measured_at' "$MEASURE_OUT")" +%s 2>/dev/null || gdate -u -d "$(jq -r '.measured_at' "$MEASURE_OUT")" +%s)
DIFF=$(( $(date -u +%s) - TS ))
[ "$DIFF" -ge 0 ] && [ "$DIFF" -le 300 ] || { echo "FAIL: measured_at 过期 ${DIFF}s"; exit 1; }

# 7. Step 6 — 独立记录 + status 枚举
jq -e 'has("planner") and has("gan") and (has("peak_rss_mb")|not) and (has("peak")|not)' "$MEASURE_OUT" \
  || { echo "FAIL: 两容器被混算或顶层有合并峰值"; exit 1; }
jq -e '([.planner.status,.gan.status]|all(.=="complete" or .=="incomplete"))' "$MEASURE_OUT" \
  || { echo "FAIL: status 枚举非法"; exit 1; }

echo "✅ Golden Path 验证通过：planner=$(jq -r '.planner.peak_rss_mb' "$MEASURE_OUT")MB gan=$(jq -r '.gan.peak_rss_mb' "$MEASURE_OUT")MB"
```

**通过标准**: 脚本 exit 0（接缝 #2 还需在真实容器上校准过才能从 logic-done-pending 转 done）。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 采样器峰值汇总逻辑 | `tests/ws1/peak-summary.test.ts` | peak=max(samples)、≥3 点校验、incomplete 标注、两容器独立 | 模块 `scripts/measure/container-mem-peak.mjs` 未导出 `summarizePeak` → import 失败 → N failures |
