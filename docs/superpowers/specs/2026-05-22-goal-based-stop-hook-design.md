# Goal-Based Stop Hook 设计文档

**日期**: 2026-05-22
**分支**: cp-0522111134-goal-based-stop-hook
**优先级**: P1

---

## 背景

当前 Cecelia stop hook 体系（stop-dev.sh + light 文件 + guardian 进程 + devloop-check.sh）存在根本性问题：

1. **被动等待**：stop hook 只能"不让 Claude 走"，但 PR 推完后 Claude 无事可做，session 在空转中等待 CI / PR 合并
2. **状态外置**：依赖文件系统（.cecelia/lights/）跨 session 传递状态，崩溃后难以恢复
3. **session ID 错位**：无头模式下 session ID 不一致导致灯文件找不到（PR #3085 只是打补丁）
4. **维护负担**：stop-dev.sh 229 行，devloop-check.sh 559 行，25+ 个测试文件

**解决方案**：用 Claude Code 官方 `/goal` 机制（`--settings` 注入 prompt-based stop hook）替换上述体系。Claude 主动监控目标条件，Haiku 评估，满足后自然退出。

---

## 架构

### 新数据流

```
Brain (executor.js)
  task.goal_condition TEXT
  → 序列化为 --settings JSON
  → extra_env.CECELIA_GOAL_SETTINGS = '{"hooks":{"Stop":[{"hooks":[{"type":"prompt",...}]}]}}'
  ↓
cecelia-bridge.js
  → CECELIA_GOAL_SETTINGS 直传（不加 SKILLENV_ 前缀）
  ↓
cecelia-run.sh
  → 检测 CECELIA_GOAL_SETTINGS → 追加 --settings "$CECELIA_GOAL_SETTINGS"
  ↓
claude 进程
  → prompt-based stop hook：每 turn 结束后 Haiku 评估 goal
  → 未满足 → block → Claude 继续主动检查（gh pr checks 等）
  → 满足 → exit 0 → Brain execution-callback 收到完成通知
```

### --settings JSON 格式

```json
{
  "hooks": {
    "Stop": [{
      "hooks": [{
        "type": "prompt",
        "prompt": "Has the following goal been achieved based on the conversation? Goal: {goal_condition}\n\nAnswer YES only if you can confirm from the conversation that the goal is met. Answer NO otherwise.",
        "model": "claude-haiku-4-5-20251001"
      }]
    }]
  }
}
```

---

## 各阶段预定义 Goal Conditions

executor.js 按 task_type 和 harness 阶段注入：

| 阶段 | goal_condition |
|------|---------------|
| spec | The spec document has been written and committed to docs/superpowers/specs/ |
| code | All implementation is complete, all tests pass, and changes are committed to git |
| prci | A pull request has been created and pushed to GitHub, PR URL is shown in the conversation |
| ship | The pull request has been merged and all CI checks have passed |
| generic | The task described in the prompt has been completed successfully |

---

## 组件变更

### 新增

| 文件 | 内容 |
|------|------|
| `packages/brain/src/migrations/272_add_goal_condition.sql` | tasks 表新增 `goal_condition TEXT` |
| `packages/brain/scripts/smoke/goal-condition-smoke.sh` | 真环境验证 |
| `packages/brain/src/__tests__/goal-settings-serializer.test.js` | 单元测试 |
| `packages/engine/tests/integration/goal-injection-chain.test.ts` | 集成测试 |

### 修改

| 文件 | 改动 |
|------|------|
| `packages/brain/src/executor.js` | 读取 task.goal_condition，生成 --settings JSON，写入 CECELIA_GOAL_SETTINGS |
| `packages/brain/scripts/cecelia-bridge.js` | CECELIA_GOAL_SETTINGS verbatim 传递（不走 SKILLENV_ 前缀转换） |
| `packages/brain/scripts/cecelia-run.sh` | 检测 CECELIA_GOAL_SETTINGS，追加 `--settings "$CECELIA_GOAL_SETTINGS"` |
| `packages/engine/hooks/stop.sh` | 移除 stop-dev.sh 路由分支，保留 architect/decomp/quality 路由 |

### 删除

| 文件 | 原因 |
|------|------|
| `packages/engine/hooks/stop-dev.sh` | 被 prompt-based stop hook 替代 |
| `packages/engine/lib/dev-heartbeat-guardian.sh` | 不再需要灯文件心跳 |
| `packages/engine/lib/devloop-check.sh` | 4 阶段判断被 goal_condition 替代 |
| `packages/engine/scripts/ship-finalize.sh` | done-marker 机制废弃 |
| `packages/engine/tests/` 中所有 stop-dev / devloop-check 相关测试 | 测试文件随被测文件一起删除 |

---

## stop.sh 简化后结构

```bash
# 删除: stop-dev.sh 路由
# 保留: architect / decomp / quality 条件路由
# 保留: conversation-summary Brain 回调
# 保留: orphan worktree cleanup
```

有 goal_condition 的 harness session：由 --settings prompt hook 接管，stop.sh 不干预。
无 goal_condition 的普通 session：stop.sh 直接 exit 0（或走 architect/decomp）。

---

## Brain DB Migration

```sql
-- 272_add_goal_condition.sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS goal_condition TEXT;
COMMENT ON COLUMN tasks.goal_condition IS 'Claude Code --settings prompt-based stop hook condition string';
```

---

## executor.js 核心逻辑

```javascript
// 在 getExtraEnvForTaskType() 之后
function buildGoalSettings(goalCondition) {
  if (!goalCondition) return null;
  return JSON.stringify({
    hooks: {
      Stop: [{
        hooks: [{
          type: 'prompt',
          prompt: `Has the following goal been achieved based on the conversation? Goal: ${goalCondition}\n\nAnswer YES only if confirmed from conversation. Answer NO otherwise.`,
          model: 'claude-haiku-4-5-20251001'
        }]
      }]
    }
  });
}

// 在构建 extra_env 时：
const goalSettings = buildGoalSettings(task.goal_condition);
if (goalSettings) {
  extraEnv.CECELIA_GOAL_SETTINGS = goalSettings;
}
```

---

## cecelia-bridge.js 改动

```javascript
// 现有 SKILLENV_ 前缀转换逻辑之外，特殊处理 CECELIA_GOAL_SETTINGS：
if (extra_env && extra_env.CECELIA_GOAL_SETTINGS) {
  envVars += `CECELIA_GOAL_SETTINGS=${JSON.stringify(extra_env.CECELIA_GOAL_SETTINGS)} `;
}
```

---

## cecelia-run.sh 改动

```bash
# 在构造 CLAUDE_INVOKE 命令行处（第 615-630 行附近）：
SETTINGS_FLAG=""
if [[ -n "${CECELIA_GOAL_SETTINGS:-}" ]]; then
  SETTINGS_FLAG="--settings $(printf '%q' "$CECELIA_GOAL_SETTINGS")"
fi

# 追加到 claude 调用：
CLAUDE_SESSION_ID=$SESSION_UUID bash $_launcher -p "$1" \
  --permission-mode "$PERMISSION_MODE" \
  --model "$MODEL" \
  --max-turns "$MAX_TURNS" \
  --output-format json \
  $SETTINGS_FLAG
```

---

## 崩溃检测（最小保留）

去掉 guardian + light 文件后，崩溃检测由 Brain 的 execution-callback 超时机制处理：

- cecelia-run.sh 正常完成 → POST execution-callback（现有逻辑）
- session 崩溃/超时 → Brain watchdog 检测 task 超时 → 标记 failed/requeue

无需新增独立心跳机制（Brain watchdog 已有）。

---

## 测试策略

### 单元测试（单函数）
- `goal-settings-serializer.test.js`：`buildGoalSettings(condition)` → 正确 JSON 结构；null 条件 → null

### 集成测试（跨模块）
- `goal-injection-chain.test.ts`：
  - executor.js extraEnv 含 CECELIA_GOAL_SETTINGS 当 task.goal_condition 非空
  - cecelia-bridge 正确转发（不加 SKILLENV_ 前缀）
  - cecelia-run --settings 出现在 claude 命令行（mock spawn 验证）

### E2E smoke（真环境）
- `packages/brain/scripts/smoke/goal-condition-smoke.sh`：
  - 创建含 goal_condition 的 task via Brain API
  - 调 execution endpoint
  - 验证返回的 extra_env 包含 CECELIA_GOAL_SETTINGS

### 回归测试
- `packages/engine/tests/hooks/stop-sh-routing.test.ts`：stop.sh 对 architect-lock 和 decomp-mode 路由仍正常（无 stop-dev.sh 的情况）

---

## 成功标准

- `tasks.goal_condition` 字段存在（migration 成功）
- executor.js 对有 goal_condition 的 task，extra_env 中包含 CECELIA_GOAL_SETTINGS
- cecelia-run.sh 对有 CECELIA_GOAL_SETTINGS 的调用，claude 命令包含 `--settings`
- stop.sh 移除 stop-dev.sh 路由后，architect/decomp 会话仍正常
- stop-dev.sh / guardian / devloop-check.sh / ship-finalize.sh 均不存在

---

## DoD

- [ ] `[ARTIFACT]` `packages/brain/src/migrations/272_add_goal_condition.sql` 存在
  - `Test: manual:node -e "require('fs').accessSync('packages/brain/src/migrations/272_add_goal_condition.sql')"`
- [ ] `[ARTIFACT]` `packages/engine/hooks/stop-dev.sh` 不存在
  - `Test: manual:node -e "const fs=require('fs');try{fs.accessSync('packages/engine/hooks/stop-dev.sh');process.exit(1)}catch{}"`
- [ ] `[ARTIFACT]` `packages/engine/lib/devloop-check.sh` 不存在
  - `Test: manual:node -e "const fs=require('fs');try{fs.accessSync('packages/engine/lib/devloop-check.sh');process.exit(1)}catch{}"`
- [ ] `[BEHAVIOR]` executor.js 对有 goal_condition 的 task 生成 CECELIA_GOAL_SETTINGS
  - `Test: tests/goal-settings-serializer.test.js`
- [ ] `[BEHAVIOR]` cecelia-run.sh 含 CECELIA_GOAL_SETTINGS 时，claude 命令含 --settings
  - `Test: tests/integration/goal-injection-chain.test.ts`
- [ ] `[BEHAVIOR]` stop.sh architect/decomp 路由在无 stop-dev.sh 情况下仍正常
  - `Test: tests/hooks/stop-sh-routing.test.ts`
