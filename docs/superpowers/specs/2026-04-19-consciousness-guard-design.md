# Consciousness Guard —— Brain 意识层统一守护

**创建日期**: 2026-04-19
**分支**: cp-0419235150-consciousness-guard
**Brain 版本**: 1.218.0 → 1.219.0 (minor bump)
**状态**: 设计已批准（autonomous via Research Subagent）

---

## 1. 背景 & 动机

Cecelia Brain（`packages/brain`）当前混了两类职责：

- **任务派发**（保留）：planner / executor / dispatch / quarantine / circuit-breaker / alertness / harness-watcher / publish-monitor
- **意识 / 自我对话**（要可控关闭）：rumination / proactive-mouth / diary-scheduler / evolution-scanner / evolution-synthesizer / desire / cognitive-core 里的叙事 / conversation-digest / conversation-consolidator / capture-digestion / self-report / notebook-feeder / thalamus（L1 LLM 路由）

现有 `BRAIN_QUIET_MODE` 开关守护不全，且主机层 `~/bin/cecelia-watchdog.sh` 重启 Brain 时**不传**这个环境变量——导致即使 plist 声明也失效。结果 xuxiao 两个 Codex Team 账号 7d 用量已打满 100%，全是意识层持续消耗。

本设计：**统一守护函数 + 扩展守护范围 + SSOT 化 watchdog**。

## 2. 目标

1. 新增 `CONSCIOUSNESS_ENABLED=false`：一个开关关闭**所有**主动烧 LLM token 的意识模块
2. 保留任务派发、执行、调度、监控、告警完全不受影响
3. 消除"部署层和代码层开关脱节"的类问题（watchdog 纳入 repo SSOT）
4. 测试 & CI 保证守护不被破坏（反向 grep 防 `BRAIN_QUIET_MODE` 裸引用复活）

非目标（Phase 2）：Dashboard toggle 按钮 / 运行时 DB memory 级热切换。

## 3. 架构

### 3.1 新模块：`packages/brain/src/consciousness-guard.js`

```js
// SSOT for consciousness toggle
const GUARDED_MODULES = [
  'thalamus', 'rumination', 'rumination-scheduler', 'narrative',
  'diary-scheduler', 'conversation-digest', 'conversation-consolidator',
  'capture-digestion', 'self-report', 'notebook-feeder',
  'proactive-mouth', 'evolution-scanner', 'evolution-synthesizer',
  'desire-system', 'suggestion-cycle', 'self-drive',
  'dept-heartbeat', 'pending-followups'
];

export function isConsciousnessEnabled() {
  // 默认 true（向后兼容现网）
  // 新 env 优先；旧 BRAIN_QUIET_MODE=true 作为 deprecated 别名
  if (process.env.CONSCIOUSNESS_ENABLED === 'false') return false;
  if (process.env.BRAIN_QUIET_MODE === 'true') {
    if (!_deprecationWarned) {
      console.warn('[consciousness-guard] BRAIN_QUIET_MODE is deprecated, use CONSCIOUSNESS_ENABLED=false');
      _deprecationWarned = true;
    }
    return false;
  }
  return true;
}

export function logStartupDeclaration() {
  if (!isConsciousnessEnabled()) {
    console.log('[Brain] CONSCIOUSNESS_ENABLED=false — 意识层全部跳过（保留任务派发/调度/监控）');
    console.log('[Brain] 守护模块: ' + GUARDED_MODULES.join('/'));
  }
}

export { GUARDED_MODULES };
```

### 3.2 使用模式

**server.js** 启动时：
```js
import { isConsciousnessEnabled, logStartupDeclaration } from './src/consciousness-guard.js';
logStartupDeclaration();

if (isConsciousnessEnabled()) {
  startSelfDriveLoop();
  // evolution-scanner setInterval
  scanEvolutionIfNeeded(pool);
  setTimeout(() => { setInterval(/* 24h */); }, 10 * 60 * 1000);
  initNarrativeTimer();
}
```

**tick.js** 原 `const BRAIN_QUIET_MODE = process.env.BRAIN_QUIET_MODE === 'true'` **删除**。所有现有 `if (!BRAIN_QUIET_MODE)` 改成 `if (isConsciousnessEnabled())`。

**禁止在本次重构后任何地方裸读 `process.env.BRAIN_QUIET_MODE` 或 `process.env.CONSCIOUSNESS_ENABLED`**，必须通过 `isConsciousnessEnabled()` 获取。CI 加反向 grep（见 6.3）。

### 3.3 守护清单 —— 用 grep 生成（实施阶段完成）

实施阶段第一步：在 writing-plans / subagent 里跑：
```bash
grep -nE '(BRAIN_QUIET_MODE|MINIMAL_MODE)' packages/brain/src/tick.js packages/brain/server.js
grep -nE 'runRumination|runSynthesisSchedulerIfNeeded|runDesireSystem|generateDailyDiaryIfNeeded|runConversationDigest|runConversationConsolidator|runCaptureDigestion|updateNarrative|runSuggestionCycle|collectSelfReport|feedDailyIfNeeded|scanEvolutionIfNeeded|synthesizeEvolutionIfNeeded|startSelfDriveLoop|initNarrativeTimer|triggerDeptHeartbeats' packages/brain/src/tick.js packages/brain/server.js
```
把结果写入 `docs/superpowers/plans/2026-04-19-consciousness-guard-plan.md` 的 "守护点真值表"。

**冻结的守护范围**（函数级，行号实施时再定）：

| # | 文件 | 函数 |
|---|---|---|
| 1 | server.js | `startSelfDriveLoop` |
| 2 | server.js | `scanEvolutionIfNeeded` + 24h setInterval |
| 3 | server.js | `initNarrativeTimer` |
| 4 | tick.js | `thalamus` block（原 QUIET_MODE 已守护，换新函数） |
| 5 | tick.js | `pending-followups` block（原 QUIET_MODE 已守护） |
| 6 | tick.js | `dept-heartbeat` block（原 QUIET_MODE 已守护） |
| 7 | tick.js | `runRumination` + `updateNarrative` |
| 8 | tick.js | `runSynthesisSchedulerIfNeeded` |
| 9 | tick.js | `generateDailyDiaryIfNeeded` ← **原来漏守护** |
| 10 | tick.js | `runConversationDigest` |
| 11 | tick.js | `runConversationConsolidator` |
| 12 | tick.js | `runCaptureDigestion` |
| 13 | tick.js | `collectSelfReport` |
| 14 | tick.js | `feedDailyIfNeeded` |
| 15 | tick.js | `scanEvolutionIfNeeded`（tick 里的 10.14，**原来漏守护**）|
| 16 | tick.js | `synthesizeEvolutionIfNeeded`（10.15，**原来漏守护**）|
| 17 | tick.js | `runSuggestionCycle` |
| 18 | tick.js | `runDesireSystem` |
| 19 | tick.js | `publishCognitiveState` 按 phase 区分：**意识 phase 守护**（`cognition` / `rumination` / `desire` / `thalamus` / `narrative` / `diary` / `emotion`）；**派发 phase 不守护**（`planning` / `dispatching` / `alertness` / `decomposition` / `idle`） |

### 3.4 **不守护**（保留派发 / 纯计算 / 健康监控）

- planner / executor / dispatchNextTask / quarantine / circuit-breaker / alertness
- slot-allocator / task-router / harness-watcher / publish-monitor
- credential-check / proactiveTokenCheck / checkQuotaGuard
- zombieSweep / pipeline-watchdog / orphan-pr-worker / cleanup-worker
- `evaluateEmotion` / `updateSubjectiveTime`（纯函数状态评估，不烧 token，且 `dispatch_rate_modifier` 依赖情绪——守护会破坏派发链）← **Research Subagent 指正**
- `getCognitiveSnapshot` / `getCurrentEmotion` / `getSubjectiveTime` / `getParallelAwareness` / `getTrustScores`（纯读，无副作用）
- `publishCognitiveState` 本身不守护，守护粒度在调用点（按 phase 区分）

## 4. 部署层

### 4.1 `packages/brain/deploy/com.cecelia.brain.plist`

```xml
<key>EnvironmentVariables</key>
<dict>
  ...
  <key>BRAIN_QUIET_MODE</key>
  <string>true</string>                        <!-- 保留兼容 -->
  <key>CONSCIOUSNESS_ENABLED</key>
  <string>false</string>                       <!-- 新，权威 -->
</dict>
```

### 4.2 `packages/brain/deploy/cecelia-watchdog.sh` （新建 SSOT）

```bash
#!/usr/bin/env bash
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin

BRAIN_DIR="/Users/administrator/perfect21/cecelia/packages/brain"
LOG_DIR="/Users/administrator/perfect21/cecelia/logs"

if ! curl -sf http://localhost:5221/api/brain/health > /dev/null 2>&1; then
  echo "[$(TZ=Asia/Shanghai date)] Brain down, restarting..." >> "$LOG_DIR/watchdog.log"
  cd "$BRAIN_DIR"
  CECELIA_WORK_DIR=/Users/administrator/perfect21/cecelia \
  REPO_ROOT=/Users/administrator/perfect21/cecelia \
  ENV_REGION=us \
  WORKTREE_BASE=/Users/administrator/perfect21/cecelia/.claude/worktrees \
  CECELIA_RUN_PATH=/Users/administrator/perfect21/cecelia/packages/brain/scripts/cecelia-run.sh \
  CONSCIOUSNESS_ENABLED=false \
  BRAIN_QUIET_MODE=true \
  nohup /opt/homebrew/bin/node server.js >> "$LOG_DIR/brain.log" 2>> "$LOG_DIR/brain-error.log" &
  echo "[$(TZ=Asia/Shanghai date)] Brain restarted, PID: $!" >> "$LOG_DIR/watchdog.log"
fi

# Bridge 同原脚本
if ! curl -sf http://localhost:3457/health > /dev/null 2>&1; then
  echo "[$(TZ=Asia/Shanghai date)] Bridge down, restarting..." >> "$LOG_DIR/watchdog.log"
  cd "$BRAIN_DIR"
  BRAIN_URL=http://localhost:5221 \
  BRIDGE_PORT=3457 \
  nohup /opt/homebrew/bin/node scripts/cecelia-bridge.cjs >> "$LOG_DIR/bridge.log" 2>> "$LOG_DIR/bridge-error.log" &
  echo "[$(TZ=Asia/Shanghai date)] Bridge restarted, PID: $!" >> "$LOG_DIR/watchdog.log"
fi
```

### 4.3 `packages/brain/deploy/install.sh`

追加（`SCRIPT_DIR` 在 install.sh 头部已定义为 `$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)`，若不存在则新增）：
```bash
# 安装 watchdog 到 ~/bin（SSOT 从 repo 拷贝）
mkdir -p "$HOME/bin"
cp "$SCRIPT_DIR/cecelia-watchdog.sh" "$HOME/bin/cecelia-watchdog.sh"
chmod +x "$HOME/bin/cecelia-watchdog.sh"
echo "✅ watchdog 已部署到 ~/bin/cecelia-watchdog.sh"
```

SIP 风险缓解：**拷贝而非软链**，避免 SIP/quarantine 拦截（Research Subagent flag）。

## 5. 测试

### 5.1 新增 `packages/brain/src/__tests__/tick-consciousness-guard.test.js`

```js
describe('consciousness guard', () => {
  beforeEach(() => { delete process.env.CONSCIOUSNESS_ENABLED; delete process.env.BRAIN_QUIET_MODE; });

  test('default: consciousness enabled', () => expect(isConsciousnessEnabled()).toBe(true));
  test('CONSCIOUSNESS_ENABLED=false disables', () => { process.env.CONSCIOUSNESS_ENABLED = 'false'; expect(isConsciousnessEnabled()).toBe(false); });
  test('BRAIN_QUIET_MODE=true backward compat', () => { process.env.BRAIN_QUIET_MODE = 'true'; expect(isConsciousnessEnabled()).toBe(false); });
  test('new env takes precedence when both set', () => { process.env.CONSCIOUSNESS_ENABLED = 'true'; process.env.BRAIN_QUIET_MODE = 'true'; expect(isConsciousnessEnabled()).toBe(true); });

  // tick 级 smoke test（mock pool / mock 所有 run* 函数）
  test('tick with CONSCIOUSNESS_ENABLED=false skips 16 guarded modules', async () => {
    // mock 所有守护函数，跑 tick，断言 0 调用
  });

  test('tick with CONSCIOUSNESS_ENABLED=true calls all modules', async () => {
    // 相同 mock，断言都被调用 ≥1 次
  });

  test('dispatch/planner always called regardless of env', async () => {
    // env=false 也要能派发
  });
});
```

### 5.2 DoD 手工验证脚本（放 `docs/superpowers/plans/` 里）

```bash
# 1. 启动
CONSCIOUSNESS_ENABLED=false node packages/brain/server.js > /tmp/brain.log 2>&1 &
sleep 15

# 2. 守护声明
grep -q "CONSCIOUSNESS_ENABLED=false — 意识层全部跳过" /tmp/brain.log || exit 1

# 3. 跑 5 分钟 tick，意识类日志不出现
sleep 300
! grep -qE '\[reflection\]|\[proactive\]|\[diary\]|\[desire\]|\[evolution\]|\[rumination\]|\[narrative\]' /tmp/brain.log

# 4. API 正常
curl -f localhost:5221/api/brain/context

# 5. 派发路径可用
curl -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" \
  -d '{"title":"smoke test","task_type":"research","priority":"P3"}'
sleep 30
grep -q "\[dispatch\] task .* dispatched" /tmp/brain.log
```

## 6. 兼容性 & 迁移

### 6.1 向后兼容
- `BRAIN_QUIET_MODE=true` 继续识别，打 `console.warn` 一次（deprecation notice）
- 保留 3 个月窗口（`~2026-07-19`）后再正式移除

### 6.2 版本升级
- `packages/brain/package.json`: `1.218.0` → `1.219.0`（minor，新增特性）
- `DEFINITION.md`：如引用 `BRAIN_QUIET_MODE`，同步改名 + 加迁移说明段落

### 6.3 CI 反向 grep（防复活）

`.github/workflows/brain-ci.yml` 或 `scripts/check-consciousness-guard.sh`：
```bash
# 禁止在非 consciousness-guard.js 文件里裸读 BRAIN_QUIET_MODE / CONSCIOUSNESS_ENABLED
if grep -rE 'process\.env\.(BRAIN_QUIET_MODE|CONSCIOUSNESS_ENABLED)' \
    packages/brain/src/ packages/brain/server.js \
    | grep -v 'consciousness-guard.js' | grep -v '__tests__/'; then
  echo "❌ 发现裸读意识开关环境变量，必须通过 isConsciousnessEnabled() 获取"
  exit 1
fi
```

### 6.4 DevGate
- `scripts/facts-check.mjs`：检查 `BRAIN_QUIET_MODE` 引用更新
- `scripts/check-version-sync.sh`：Brain 版本四处（package.json / DEFINITION.md / changelog / brain-manifest）同步

## 7. 验收标准（DoD）

1. ✅ `CONSCIOUSNESS_ENABLED=false node server.js` 启动 → 日志 `[Brain] CONSCIOUSNESS_ENABLED=false — 意识层全部跳过`
2. ✅ 跑 5 分钟 tick，`grep -E '\[reflection\]|\[proactive-mouth\]|\[diary\]|\[desire\]|\[evolution\]|\[rumination\]'` 无输出
3. ✅ `curl localhost:5221/api/brain/context` 返回正常 JSON
4. ✅ 手动 `POST /api/brain/tasks` 能派发 → `[dispatch] task X dispatched` 出现
5. ✅ `tick-consciousness-guard.test.js` 全绿（≥6 tests）
6. ✅ DevGate 绿：facts-check / check-version-sync / check-dod-mapping
7. ✅ brain-ci.yml 通过（含反向 grep 检查）
8. ✅ `packages/brain/deploy/cecelia-watchdog.sh` 存在 + `install.sh` 能部署到 `~/bin/`

## 8. 风险 & 缓解

| 风险 | 缓解 |
|---|---|
| `evaluateEmotion` 被误守护 → 派发链断 | 明确排除在守护清单外，Spec 里标红 |
| 守护清单行号漂移 | 实施阶段用 grep 生成，不硬编码行号 |
| watchdog 软链 SIP 问题 | `cp` 而非 `ln -s` |
| 重构后有地方仍裸读 `BRAIN_QUIET_MODE` | CI 反向 grep 阻断 |
| 现网 plist 没及时更新 | 保留 `BRAIN_QUIET_MODE=true` 兼容别名，双写过渡 |
| 并发 claude 会话冲突（cleanup-regex-fix 卡死） | 本 worktree 独立分支，不共享文件 |

## 9. 不在本次范围

- Dashboard toggle 按钮（Phase 2，需新 API + 前端 + DB memory key）
- Memory DB 级运行时热切换
- 删除 `BRAIN_QUIET_MODE`（3 个月兼容窗口后单独 PR）
- 其他模块的类似"混合职责"拆解（L0/L1/L2 完整分离属于更大 Initiative）

---

**批准**: Research Subagent APPROVE_WITH_CAVEATS (caveats 已吸收入 3.3/3.4/4.2)
**下一步**: 本 spec 通过 self-review + user 审查后 → `writing-plans` skill 生成实施计划
