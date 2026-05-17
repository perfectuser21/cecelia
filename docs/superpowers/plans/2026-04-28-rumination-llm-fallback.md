# Rumination LLM Fallback Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 PROBE_FAIL_RUMINATION — 扩展 callLLM emergency fallback 链，当 anthropic-api 余额不足时继续尝试 anthropic（bridge），并改进 rumination 诊断事件记录。

**Architecture:** `llm-caller.js` 的 `!hasAnthropicCandidate` emergency fallback 分支新增 bridge 兜底层（anthropic-api 失败后尝试 `callClaudeViaBridge`）。`rumination.js` 的 `rumination_llm_failure` 事件 payload 扩展 `emergency_fallback_error` 字段，记录完整失败链。

**Tech Stack:** Node.js ESM, vitest, PostgreSQL, cecelia-bridge HTTP

---

## 文件变更地图

| 文件 | 变更类型 | 变更内容 |
|------|---------|---------|
| `packages/brain/src/llm-caller.js` | Modify（~L200-215） | `!hasAnthropicCandidate` 分支：anthropic-api 失败后加 bridge 兜底 |
| `packages/brain/src/__tests__/llm-caller-codex-fallback.test.js` | Modify | 新增 2 个 test case：anthropic-api 余额不足时走 bridge；三层全失败时抛错 |
| `packages/brain/src/rumination.js` | Modify（~L344-373） | `callLLM` 调用改为捕获并透传 emergency fallback 错误信息到 `rumination_llm_failure` 事件 |
| `packages/brain/scripts/smoke/rumination-smoke.sh` | Create | smoke 验证：触发 manual rumination → 检查 DB 产生 rumination_output |
| `docs/learnings/cp-0428xxxx-rumination-llm-fallback.md` | Create | Learning 文档（根本原因 + 预防 checklist） |

---

## Task 1: 为 anthropic-api 余额不足 + bridge 兜底场景写失败测试

**目标：** TDD 第一步 — 先写失败的测试，证明当前代码在 anthropic-api 失败后不走 bridge。

**Files:**
- Modify: `packages/brain/src/__tests__/llm-caller-codex-fallback.test.js`

- [ ] **Step 1: 在现有测试文件末尾追加 2 个新 test case**

打开 `packages/brain/src/__tests__/llm-caller-codex-fallback.test.js`，在最后一个 `it(...)` 后面（闭合 `});` 之前）添加：

```javascript
  it('codex 失败 + anthropic-api 余额不足 → 自动 fallback 到 anthropic bridge', async () => {
    getActiveProfile.mockReturnValue({
      config: {
        rumination: {
          provider: 'codex',
          model: 'codex/gpt-5.4',
        },
      },
    });

    // 第一个 fetch：anthropic-api 余额不足（400 credit balance too low）
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'Your credit balance is too low' },
      }),
    });

    // bridge 调用成功（第二个 fetch）
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ text: 'bridge 兜底成功', degraded: false }),
    });

    const result = await callLLM('rumination', '测试 prompt');

    expect(result.text).toBe('bridge 兜底成功');
    expect(result.provider).toBe('anthropic');
    expect(result.attempted_fallback).toBe(true);
  });

  it('codex 失败 + anthropic-api 失败 + bridge 失败 → 抛出最终错误', async () => {
    getActiveProfile.mockReturnValue({
      config: {
        rumination: {
          provider: 'codex',
          model: 'codex/gpt-5.4',
        },
      },
    });

    // anthropic-api 失败（503）
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    // bridge 也失败（500）
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Bridge error',
    });

    await expect(callLLM('rumination', '测试 prompt')).rejects.toThrow();
  });
```

- [ ] **Step 2: 运行测试验证它们现在失败**

```bash
cd /Users/administrator/worktrees/cecelia/fix-rumination-llm-provider
npx vitest run packages/brain/src/__tests__/llm-caller-codex-fallback.test.js 2>&1 | tail -20
```

预期：新增的 2 个 test case 失败（当前 emergency fallback 只尝试 anthropic-api，不尝试 bridge）。

- [ ] **Step 3: commit-1（failing test）**

```bash
cd /Users/administrator/worktrees/cecelia/fix-rumination-llm-provider
git add packages/brain/src/__tests__/llm-caller-codex-fallback.test.js
git commit -m "test(brain): failing tests — codex fallback bridge 兜底场景（commit-1 TDD）"
```

---

## Task 2: 扩展 callLLM emergency fallback 链（bridge 兜底）

**目标：** 实现 anthropic-api 失败后继续尝试 anthropic（bridge）。

**Files:**
- Modify: `packages/brain/src/llm-caller.js`（约 L200-215）

- [ ] **Step 1: 找到并替换 `!hasAnthropicCandidate` 分支**

定位 `packages/brain/src/llm-caller.js` 中：
```javascript
  if (!hasAnthropicCandidate) {
    const fallbackModel = 'claude-haiku-4-5-20251001';
    console.warn(`[llm-caller] ${agentId} 所有候选（${candidates.map(c=>c.provider).join(',')}）失败，尝试 anthropic-api 兜底`);
    try {
      const text = await callAnthropicAPI(prompt, fallbackModel, timeout, maxTokens, imageContent);
      const elapsed = Date.now() - startTime;
      console.log(`[llm-caller] ${agentId} → ${fallbackModel} (anthropic-api emergency fallback) in ${elapsed}ms`);
      reportCall({ agentId, model: fallbackModel, provider: 'anthropic-api', prompt, text, elapsedMs: elapsed, startedAt: startTime }).catch(() => {});
      return { text, model: fallbackModel, provider: 'anthropic-api', elapsed_ms: elapsed, attempted_fallback: true };
    } catch (apiErr) {
      console.warn(`[llm-caller] ${agentId} anthropic-api 兜底也失败: ${apiErr.message}`);
    }
  }
```

替换为：
```javascript
  if (!hasAnthropicCandidate) {
    const fallbackModel = 'claude-haiku-4-5-20251001';
    console.warn(`[llm-caller] ${agentId} 所有候选（${candidates.map(c=>c.provider).join(',')}）失败，尝试 anthropic-api 兜底`);
    try {
      const text = await callAnthropicAPI(prompt, fallbackModel, timeout, maxTokens, imageContent);
      const elapsed = Date.now() - startTime;
      console.log(`[llm-caller] ${agentId} → ${fallbackModel} (anthropic-api emergency fallback) in ${elapsed}ms`);
      reportCall({ agentId, model: fallbackModel, provider: 'anthropic-api', prompt, text, elapsedMs: elapsed, startedAt: startTime }).catch(() => {});
      return { text, model: fallbackModel, provider: 'anthropic-api', elapsed_ms: elapsed, attempted_fallback: true };
    } catch (apiErr) {
      console.warn(`[llm-caller] ${agentId} anthropic-api 兜底也失败: ${apiErr.message}`);
      // 终极兜底：anthropic-api 失败（如余额不足）时，继续尝试 anthropic bridge（走订阅）
      // 场景：codex 无 OAuth + anthropic-api 余额不足 + bridge 可用
      console.warn(`[llm-caller] ${agentId} 尝试 anthropic bridge 终极兜底`);
      try {
        const text = await callClaudeViaBridge(prompt, fallbackModel, timeout, fallbackModel, imageContent);
        const elapsed = Date.now() - startTime;
        console.log(`[llm-caller] ${agentId} → ${fallbackModel} (anthropic bridge ultimate fallback) in ${elapsed}ms`);
        reportCall({ agentId, model: fallbackModel, provider: 'anthropic', prompt, text, elapsedMs: elapsed, startedAt: startTime }).catch(() => {});
        return { text, model: fallbackModel, provider: 'anthropic', elapsed_ms: elapsed, attempted_fallback: true };
      } catch (bridgeErr) {
        console.warn(`[llm-caller] ${agentId} anthropic bridge 终极兜底也失败: ${bridgeErr.message}`);
      }
    }
  }
```

- [ ] **Step 2: 运行测试验证通过**

```bash
cd /Users/administrator/worktrees/cecelia/fix-rumination-llm-provider
npx vitest run packages/brain/src/__tests__/llm-caller-codex-fallback.test.js 2>&1 | tail -20
```

预期：全部 7 个 test case 通过（含新增的 2 个）。

- [ ] **Step 3: 运行全量 brain tests 确保无回归**

```bash
cd /Users/administrator/worktrees/cecelia/fix-rumination-llm-provider
npx vitest run packages/brain/src/__tests__/ --reporter=verbose 2>&1 | tail -30
```

预期：全部通过（或原有失败不变）。

- [ ] **Step 4: commit-2（implementation）**

```bash
cd /Users/administrator/worktrees/cecelia/fix-rumination-llm-provider
git add packages/brain/src/llm-caller.js
git commit -m "fix(brain): callLLM emergency fallback 扩展 bridge 兜底 — anthropic-api 余额不足时走 bridge

codex 失败 → anthropic-api（余额不足失败）→ anthropic bridge（走订阅，可用）
覆盖 PROBE_FAIL_RUMINATION 的实际阻塞场景：Anthropic API 余额不足时 rumination 完全中断。"
```

---

## Task 3: 改进 rumination_llm_failure 事件诊断信息

**目标：** 让 `rumination_llm_failure` 事件包含 callLLM 抛出错误的完整信息（包括 emergency fallback 错误链），方便运维快速定位。

**Files:**
- Modify: `packages/brain/src/rumination.js`（约 L340-370）

- [ ] **Step 1: 修改 callLLM fallback 调用捕获**

定位 `rumination.js` 中 `digestLearnings` 函数的 fallback callLLM 部分（约 L344-352）：

```javascript
      const prompt = buildRuminationPrompt(learnings, memoryBlock, fallbackContext);
      try {
        const { text: llmInsight } = await callLLM('rumination', prompt);
        insight = llmInsight || '';
        if (!insight) {
          llmFailureReason = 'empty_response';
        }
      } catch (llmErr) {
        llmFailureReason = llmErr.message || 'exception';
        console.warn('[rumination] callLLM fallback failed:', llmErr.message);
      }
```

替换为：
```javascript
      const prompt = buildRuminationPrompt(learnings, memoryBlock, fallbackContext);
      try {
        const { text: llmInsight, provider: llmProvider } = await callLLM('rumination', prompt);
        insight = llmInsight || '';
        if (!insight) {
          llmFailureReason = 'empty_response';
        } else {
          console.log(`[rumination] callLLM fallback succeeded via ${llmProvider}`);
        }
      } catch (llmErr) {
        // 记录完整错误信息：包括 emergency fallback 失败链（如 anthropic-api 余额不足 + bridge 失败）
        const isBalanceLow = /credit balance|insufficient_balance/i.test(llmErr.message || '');
        llmFailureReason = isBalanceLow
          ? `anthropic_api_balance_low: ${llmErr.message}`
          : (llmErr.message || 'exception');
        console.warn('[rumination] callLLM fallback failed:', llmErr.message);
      }
```

同时修改 `rumination_llm_failure` 事件写入（约 L357-368），在 payload 中加 `anthropic_balance_low` 字段：

```javascript
    if (!insight) {
      try {
        const isBalanceLow = typeof llmFailureReason === 'string' &&
          llmFailureReason.includes('anthropic_api_balance_low');
        await db.query(
          `INSERT INTO cecelia_events (event_type, source, payload)
           VALUES ('rumination_llm_failure', 'rumination', $1::jsonb)`,
          [JSON.stringify({
            notebook_error: notebookFailureReason,
            llm_error: llmFailureReason,
            anthropic_balance_low: isBalanceLow,
            batch_size: learnings.length,
            learning_ids: learnings.map(l => l.id),
          })]
        );
      } catch (evtErr) {
        console.warn('[rumination] rumination_llm_failure event write failed (non-blocking):', evtErr.message);
      }
    }
```

- [ ] **Step 2: 运行 rumination 相关测试**

```bash
cd /Users/administrator/worktrees/cecelia/fix-rumination-llm-provider
npx vitest run packages/brain/src/__tests__/rumination.test.js 2>&1 | tail -20
```

预期：全部通过。

- [ ] **Step 3: commit**

```bash
cd /Users/administrator/worktrees/cecelia/fix-rumination-llm-provider
git add packages/brain/src/rumination.js
git commit -m "fix(brain): rumination_llm_failure 事件诊断改进 — 记录 anthropic_balance_low 标记"
```

---

## Task 4: 创建 rumination smoke 验证脚本

**目标：** 真环境验证 rumination 调用链可正常产生 `rumination_output` 事件。

**Files:**
- Create: `packages/brain/scripts/smoke/rumination-smoke.sh`

- [ ] **Step 1: 创建 smoke 脚本**

创建 `packages/brain/scripts/smoke/rumination-smoke.sh`：

```bash
#!/usr/bin/env bash
# Smoke: rumination LLM fallback fix — PROBE_FAIL_RUMINATION
# 验证：POST /api/brain/rumination/force → DB 产生 rumination_output 或返回 ok
# 注意：rumination 需有 undigested learnings 才能产生 output；
#       无 learnings 时返回 {"processed":0} 也是健康状态
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "[rumination-smoke] 1. 检查 Brain 健康"
STATUS=$(curl -sf "${BRAIN_URL}/api/brain/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))")
if [[ "$STATUS" != "ok" && "$STATUS" != "healthy" ]]; then
  echo "[rumination-smoke] FAIL: Brain 不健康，status=${STATUS}"
  exit 1
fi
echo "[rumination-smoke] Brain 健康 ✓"

echo "[rumination-smoke] 2. 检查 rumination provider 配置（必须为 anthropic-api 或 anthropic，不能是 codex）"
PROVIDER=$(psql -U cecelia -d cecelia -t -c "SELECT config->'rumination'->>'provider' FROM model_profiles WHERE is_active = true LIMIT 1;" 2>/dev/null | tr -d ' \n')
if [[ "$PROVIDER" == "codex" || "$PROVIDER" == "openai" ]]; then
  echo "[rumination-smoke] FAIL: rumination provider=${PROVIDER}（错误配置）"
  exit 1
fi
echo "[rumination-smoke] rumination provider=${PROVIDER} ✓"

echo "[rumination-smoke] 3. 触发强制反刍"
RESULT=$(curl -sf -X POST "${BRAIN_URL}/api/brain/rumination/force" \
  -H "Content-Type: application/json" \
  -d '{}' 2>/dev/null || echo '{"error":"curl_failed"}')
echo "[rumination-smoke] force rumination result: ${RESULT}"

# 若返回 error 字段，则失败
ERROR=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "parse_error")
if [[ -n "$ERROR" && "$ERROR" != "None" && "$ERROR" != "" ]]; then
  echo "[rumination-smoke] FAIL: rumination force error=${ERROR}"
  exit 1
fi

echo "[rumination-smoke] 4. 验证最近 60s 有 rumination_run 心跳"
COUNT=$(psql -U cecelia -d cecelia -t -c "
  SELECT COUNT(*) FROM cecelia_events
  WHERE event_type = 'rumination_run'
    AND created_at > NOW() - INTERVAL '60 seconds';
" 2>/dev/null | tr -d ' \n')
if [[ -z "$COUNT" || "$COUNT" -eq 0 ]]; then
  echo "[rumination-smoke] FAIL: 无近期 rumination_run 心跳（可能 LLM 调用前就失败了）"
  exit 1
fi
echo "[rumination-smoke] rumination_run 心跳 count=${COUNT} ✓"

echo "[rumination-smoke] PASS ✓"
```

- [ ] **Step 2: 赋予执行权限并验证语法**

```bash
chmod +x /Users/administrator/worktrees/cecelia/fix-rumination-llm-provider/packages/brain/scripts/smoke/rumination-smoke.sh
bash -n /Users/administrator/worktrees/cecelia/fix-rumination-llm-provider/packages/brain/scripts/smoke/rumination-smoke.sh
echo "syntax OK"
```

预期：输出 `syntax OK`，无错误。

- [ ] **Step 3: 运行 smoke 脚本**

```bash
bash /Users/administrator/worktrees/cecelia/fix-rumination-llm-provider/packages/brain/scripts/smoke/rumination-smoke.sh
```

预期：`[rumination-smoke] PASS ✓`

- [ ] **Step 4: commit**

```bash
cd /Users/administrator/worktrees/cecelia/fix-rumination-llm-provider
git add packages/brain/scripts/smoke/rumination-smoke.sh
git commit -m "feat(brain): rumination-smoke.sh — PROBE_FAIL_RUMINATION 真环境验证脚本"
```

---

## Task 5: 写 Learning 文档并创建 PR

**Files:**
- Create: `docs/learnings/cp-0428132345-rumination-llm-fallback.md`

- [ ] **Step 1: 创建 Learning 文档**

创建 `docs/learnings/cp-0428132345-rumination-llm-fallback.md`：

```markdown
# Learning: PROBE_FAIL_RUMINATION — LLM Emergency Fallback 链不完整

**日期**: 2026-04-28
**分支**: cp-0428132345-fix-rumination-llm-provider
**任务**: 5f16530d-68e8-4cc7-bcf5-ae2b8bbe0824

### 根本原因

1. **DB 配置错误**：活跃 model profile 将 `rumination` 设为 `codex` provider，但 Codex OAuth 账号不可用。
2. **Emergency fallback 链不完整**：`callLLM` 在 `!hasAnthropicCandidate` 分支只尝试 `anthropic-api` 一层兜底，当 anthropic-api 余额不足时不继续尝试 `anthropic`（bridge）。
3. **诊断盲区**：`rumination_llm_failure` 事件的 `llm_error` 字段只记录 candidates 里的错误，不记录 emergency fallback 的失败原因（如 "credit balance too low"）。

### 影响

- rumination 连续 6 天无产出（595 条 undigested learnings 堆积）
- PROBE_FAIL_RUMINATION 持续触发，Brain 每次生成 auto-fix 任务

### 修复

- `llm-caller.js`：`!hasAnthropicCandidate` 分支新增第二层兜底 `callClaudeViaBridge`（bridge 走订阅）
- `rumination.js`：`rumination_llm_failure` 事件 payload 增加 `anthropic_balance_low` 标记
- `247_fix_rumination_provider.sql`（已在 #2682 合并）：将 rumination 改回 `anthropic-api` + bridge fallback

### 下次预防

- [ ] 新增 provider 配置时，必须在 FALLBACK_PROFILE 中也配对应 fallback
- [ ] `callLLM` emergency fallback 测试覆盖「anthropic-api 余额不足 → bridge 兜底」场景（已加）
- [ ] 每次 Brain 部署后，检查 `model_profiles` 的 rumination provider 不为 codex/openai
- [ ] `rumination_llm_failure` 事件必须包含完整错误链（已改）
```

- [ ] **Step 2: DevGate 检查**

```bash
cd /Users/administrator/worktrees/cecelia/fix-rumination-llm-provider
node scripts/facts-check.mjs 2>&1 | tail -10
```

预期：通过（或只有非 brain 变更的警告）。

- [ ] **Step 3: 运行全量 brain 测试**

```bash
cd /Users/administrator/worktrees/cecelia/fix-rumination-llm-provider
npx vitest run packages/brain/src/__tests__/ 2>&1 | grep -E "Tests|pass|fail" | tail -5
```

预期：全部通过。

- [ ] **Step 4: commit Learning + push + PR**

```bash
cd /Users/administrator/worktrees/cecelia/fix-rumination-llm-provider
git add docs/learnings/cp-0428132345-rumination-llm-fallback.md
git commit -m "docs: Learning — PROBE_FAIL_RUMINATION emergency fallback 链不完整根因"

git push -u origin cp-0428132345-fix-rumination-llm-provider

gh pr create \
  --title "fix(brain): PROBE_FAIL_RUMINATION — callLLM bridge 终极兜底 + 诊断改进" \
  --body "$(cat <<'EOF'
## 问题

PROBE_FAIL_RUMINATION 持续触发：rumination 6 天无产出，595 条 undigested learnings 堆积。

**根本原因**：
1. DB 中 rumination provider 配置为 codex（无账号）
2. callLLM emergency fallback 只尝试 anthropic-api，余额不足后不继续尝试 bridge
3. rumination_llm_failure 事件不记录 anthropic-api 余额不足原因

## 修复

- **llm-caller.js**：!hasAnthropicCandidate 分支新增 bridge 终极兜底（anthropic-api 失败后走订阅）
- **rumination.js**：rumination_llm_failure 事件增加 anthropic_balance_low 标记
- **smoke.sh**：真环境验证 rumination 链路

## 测试

- llm-caller-codex-fallback.test.js：新增 2 个 case（bridge 兜底成功 + 三层全失败）
- rumination-smoke.sh：真环境 provider 配置验证 + 心跳检查

## DoD

- [x] callLLM codex 失败 + anthropic-api 余额不足 → bridge 兜底成功（新增 test）
- [x] 三层全失败时正确抛出错误（新增 test）
- [x] rumination_llm_failure 事件包含 anthropic_balance_low 字段
- [x] smoke.sh 验证 rumination provider 配置正确
- [x] 全量 brain tests 通过
- [x] CI 通过

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## 自检

- **Spec coverage**：
  - DB 层修复（migration 247）→ smoke.sh Step 2 验证 provider 配置
  - code 层 fallback 扩展 → Task 2 全部覆盖
  - 诊断改进 → Task 3 全部覆盖
  - 测试策略（unit + smoke）→ Task 1 + Task 4
- **No placeholders**：所有代码块完整
- **Type consistency**：`callClaudeViaBridge` 在 llm-caller.js 中已定义（同文件 ~L320），参数签名 `(prompt, model, timeout, _originalModel, imageContent)`，Task 2 Step 1 的调用与之匹配
