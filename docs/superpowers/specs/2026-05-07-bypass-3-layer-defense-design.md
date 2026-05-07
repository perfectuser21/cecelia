# Stop Hook BYPASS 三层防滥用 Spec

> 日期：2026-05-07
> Brain task：`97f6543b-a01f-4b60-906c-1150236468b3`
> 前置 PRs：#2823 + #2826 + #2827 + #2828 (v23 完整序列)
> 范围：BYPASS 反 AI 滥用加固

---

## 1. 现状漏洞

| 缺口 | 影响 |
|---|---|
| 单因子触发（仅 env） | AI 改 `~/.zshrc` 加 `export CECELIA_STOP_HOOK_BYPASS=1` 即可下次启动绕过 |
| 仅本地 jsonl 日志 | AI 可 `rm ~/.claude/hook-logs/stop-dev.jsonl` 销证据 |
| 无 git lint | committed 文件含 `BYPASS=1` 不会被 CI 抓 |

## 2. 三层防御

### 层 1：git lint
新建 `scripts/check-bypass-not-committed.sh`：扫所有 `git ls-files` 含 `CECELIA_STOP_HOOK_BYPASS=1` 字样的，**除豁免清单**外即 fail。

豁免：
- `packages/engine/hooks/stop-dev.sh`（合法引用）
- `packages/engine/tests/**/*bypass*`（测试用）
- `docs/**/*bypass*`（设计文档引用）
- `scripts/check-bypass-not-committed.sh` 自身

CI 接入：`.github/workflows/ci.yml` 加 `lint-bypass-not-committed` job。

### 层 2：Brain alert（异步 fire-and-forget）
stop-dev.sh BYPASS 触发路径加：

```bash
fire_bypass_alert() {
    local marker_state="$1"  # valid|stale|missing
    local payload="{\"title\":\"[ALERT] STOP HOOK BYPASS fired\",\"priority\":\"P0\",\"task_type\":\"alert\",\"description\":\"hostname=$(hostname -s) ppid=$PPID marker=$marker_state ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"trigger_source\":\"hook\",\"location\":\"us\",\"domain\":\"agent_ops\"}"
    curl -s --max-time 2 -X POST "http://localhost:5221/api/brain/tasks" \
      -H "Content-Type: application/json" \
      -d "$payload" </dev/null >/dev/null 2>&1 &
    disown 2>/dev/null || true
}
```

**触发时机**：env=1 检测到时（不论 marker 是否有效），fire 一次 P0 task。Brain P0 task 自动推飞书（已有机制）→ 用户立刻看到。

**Brain 离线时**：curl --max-time 2 失败，fire-and-forget 静默丢，hook 决策不受影响。

### 层 3：双因子触发
BYPASS 实际生效需同时满足：
- env `CECELIA_STOP_HOOK_BYPASS=1`
- `<main_repo>/.cecelia/.bypass-active` 文件存在
- marker mtime < 30 分钟（1800 秒）

**只满足 env 不满足 marker → 不视为 bypass，回到正常决策流（fail-safe）**。仍 alert Brain（可见性）。

人工启用流程：
```bash
$ touch <main_repo>/.cecelia/.bypass-active
$ export CECELIA_STOP_HOOK_BYPASS=1
$ # 调试...
# 30 分钟后 marker 自动过期
```

## 3. 测试策略

### Unit
`tests/hooks/stop-hook-bypass-3layer.test.ts` (新增 4 case)：
- C1: env=1 + 无 marker → 不 bypass（走正常决策）
- C2: env=1 + fresh marker → bypass（release）
- C3: env=1 + stale marker (>30min) → 不 bypass
- C4: env=0 + fresh marker → 不 bypass（marker alone 不够）

### Integration
- `tests/skills/check-bypass-lint.test.ts`（新增 2 case）：
  - 故意在临时文件加 `CECELIA_STOP_HOOK_BYPASS=1`，run lint script，应 exit 1
  - 豁免文件含 BYPASS=1，run lint，应 exit 0

### 行为回归
- PR-2 测试矩阵的 BYPASS=1 case **必须更新**（原期望 release，新期望"双因子才 release"）

## 4. DoD

```
- [ARTIFACT] scripts/check-bypass-not-committed.sh 存在 + chmod +x
  Test: manual:node -e "const fs=require('fs');const s=fs.statSync('scripts/check-bypass-not-committed.sh');if(!(s.mode&0o111))process.exit(1)"

- [ARTIFACT] stop-dev.sh 含 marker 检查 + fire_bypass_alert 函数
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/hooks/stop-dev.sh','utf8');if(!c.includes('.bypass-active')||!c.includes('fire_bypass_alert'))process.exit(1)"

- [BEHAVIOR] env=1 + 无 marker → 不 bypass — Test: tests/hooks/stop-hook-bypass-3layer.test.ts
- [BEHAVIOR] env=1 + fresh marker → bypass — Test: 同上
- [BEHAVIOR] env=1 + stale marker → 不 bypass — Test: 同上
- [BEHAVIOR] env=0 + fresh marker → 不 bypass — Test: 同上
- [BEHAVIOR] check-bypass-not-committed.sh 抓非豁免 BYPASS=1 — Test: tests/skills/check-bypass-lint.test.ts
- [BEHAVIOR] PR-2 BYPASS test 更新为双因子 — Test: tests/hooks/stop-hook-v23-decision.test.ts
- [BEHAVIOR] PR-2.5 + PR-3 历史测试矩阵保持 PASS — Test: 已有测试
```

## 5. Engine 三要素

1. PR title `[CONFIG]`
2. 8 文件 version bump 18.25.0 → **18.26.0**（minor，新行为）
3. feature-registry.yml stop-hook 加 V11 invariant + 18.26.0 changelog

## 6. Commit 顺序

```
commit 1: test(engine): BYPASS 3-layer defense — fail tests
  - tests/hooks/stop-hook-bypass-3layer.test.ts (4 case)
  - tests/skills/check-bypass-lint.test.ts (2 case)
  - 更新 stop-hook-v23-decision.test.ts BYPASS case 期望

commit 2: [CONFIG] feat(engine): BYPASS 3-layer defense
  - stop-dev.sh: 双因子检查 + fire_bypass_alert
  - scripts/check-bypass-not-committed.sh (新建 + chmod +x)
  - .github/workflows/ci.yml: 加 lint-bypass-not-committed job
  - feature-registry.yml: V11 invariant + 18.26.0 changelog
  - 8 文件 version bump
```

## 7. 风险

| 风险 | 缓解 |
|---|---|
| Brain alert 误报（用户合法 bypass） | 报 P0 task，用户看到一眼判断关掉/确认；不阻塞 |
| marker mtime 30min 太短 | 环境变量 BYPASS_MARKER_TTL_SEC 可覆盖（默认 1800） |
| AI touch marker + export env 双下手 | git untracked 留痕；Brain alert 推飞书；3 层都过滤不下来时人能看到 |
