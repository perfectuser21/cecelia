---
id: phase2-engine-review
version: 1.0.0
created: 2026-02-26
updated: 2026-02-26
changelog:
  - 1.0.0: 初始版本 - packages/engine 代码审查报告
---

# Phase 2 审查报告：packages/engine（开发引擎）

**审查日期**：2026-02-26
**审查范围**：packages/engine/ 目录
**审查重点**：hooks/、skills/dev/、DevGate 脚本、scripts/

---

## 审查摘要

| 维度 | 发现数量 |
|------|----------|
| L1 阻塞性问题 | 3 |
| L2 功能性问题 | 5 |
| L3 最佳实践 | 4 |
| 安全问题 | 0 |

---

## L1 问题（必须修）

### [L1-001] branch-protect.sh - 数据库检查失败时静默放行

**文件**：`hooks/branch-protect.sh:216-256`

**问题描述**：
当 `.dev-mode` 文件存在且包含 `task_id` 时，脚本会尝试从数据库检查 PRD 和 DoD 初稿。但当 curl 或 jq 命令失败时（如 Brain 服务未运行），脚本会静默执行到末尾并 `exit 0`，绕过了分支保护。

**问题代码**：
```bash
if command -v curl &>/dev/null && command -v jq &>/dev/null; then
    TASK_INFO=$(curl -s "http://localhost:5221/api/brain/tasks/${TASK_ID}" 2>/dev/null || echo "")
    # ... 数据库检查 ...
fi
# 如果 curl/jq 不存在或请求失败，代码继续执行到最后 exit 0
```

**风险**：用户可以在没有有效 PRD/DoD 的情况下写代码

**建议修复**：
```bash
# 方法 1：当有 task_id 但无法连接数据库时，应该报错而不是放行
if [[ -n "$TASK_ID" ]]; then
    if ! command -v curl &>/dev/null || ! command -v jq &>/dev/null; then
        echo "[ERROR] 需要 curl + jq 才能进行数据库检查" >&2
        exit 2
    fi
    TASK_INFO=$(curl -s "http://localhost:5221/api/brain/tasks/${TASK_ID}" 2>/dev/null || echo "")
    if [[ -z "$TASK_INFO" ]]; then
        echo "[ERROR] 无法连接到 Brain 服务 (localhost:5221)" >&2
        echo "请确保 Brain 服务正在运行，或删除 .dev-mode 文件" >&2
        exit 2
    fi
    # ... 其余检查 ...
fi
```

---

### [L1-002] stop-dev.sh - 并发锁 fallback 路径缺少锁文件目录检查

**文件**：`hooks/stop-dev.sh:73-74`

**问题描述**：
当无法加载 lock-utils.sh 时，脚本使用内联 flock fallback。但 `LOCK_DIR` 的获取逻辑在 git 命令失败时会回退到 `/tmp`，可能导致锁文件写入失败但脚本继续执行。

**问题代码**：
```bash
LOCK_DIR="$(git rev-parse --show-toplevel 2>/dev/null)/.git" || LOCK_DIR="/tmp"
LOCK_FILE="$LOCK_DIR/cecelia-stop.lock"
exec 200>"$LOCK_FILE"  # 如果 LOCK_DIR 不可写，这里会静默失败
```

**风险**：并发控制失效，多个会话可能同时操作

**建议修复**：
```bash
# 确保锁目录存在且可写
LOCK_DIR="$(git rev-parse --show-toplevel 2>/dev/null)/.git" || LOCK_DIR="/tmp"
if [[ ! -d "$LOCK_DIR" ]] || [[ ! -w "$LOCK_DIR" ]]; then
    LOCK_DIR="/tmp"
fi
LOCK_FILE="$LOCK_DIR/cecelia-stop.lock"
mkdir -p "$LOCK_DIR" 2>/dev/null || true
exec 200>"$LOCK_FILE" || {
    echo "[ERROR] 无法创建锁文件: $LOCK_FILE" >&2
    exit 2
}
```

---

### [L1-003] check-dod-mapping.cjs - evidence 文件查找逻辑可能被利用

**文件**：`scripts/devgate/check-dod-mapping.cjs:259-273`

**问题描述**：
当找不到精确的 evidence 文件时，脚本会列出所有 `.quality-evidence.*.json` 文件并使用最新的一个。这个逻辑可能在 CI 环境中误用其他构建的 evidence 文件，导致验证不准确。

**问题代码**：
```javascript
// 尝试找任意 evidence 文件（本地开发时可能 SHA 不匹配）
const files = fs.readdirSync(projectRoot).filter(f => f.startsWith('.quality-evidence.') && f.endsWith('.json'));
if (files.length === 0) {
  return { valid: false, reason: `manual: 需要 evidence 文件` };
}
// 使用最新的 evidence 文件 - 这里可能用错文件
const latestEvidence = path.join(projectRoot, files.sort().pop());
return validateManualEvidence(latestEvidence, evidenceId);
```

**风险**：验证错误的 evidence 文件，可能导致质量门禁失效

**建议修复**：
```javascript
// CI 环境中不应该fallback 到任意文件
if (process.env.GITHUB_ACTIONS) {
  return {
    valid: false,
    reason: `manual:${evidenceId} - CI 环境中必须使用精确的 evidence 文件 (当前 SHA: ${HEAD_SHA})`
  };
}
// 本地开发时才允许 fallback
const files = fs.readdirSync(projectRoot).filter(f => f.startsWith('.quality-evidence.') && f.endsWith('.json'));
if (files.length === 0) {
  return { valid: false, reason: `manual: 需要 evidence 文件` };
}
// 按时间戳排序确保用最新的
files.sort((a, b) => fs.statSync(path.join(projectRoot, b)).mtime - fs.statSync(path.join(projectRoot, a)).mtime);
const latestEvidence = path.join(projectRoot, files[0]);
return validateManualEvidence(latestEvidence, evidenceId);
```

---

## L2 问题（建议修）

### [L2-001] branch-protect.sh - 分支正则不支持中文分支名

**文件**：`hooks/branch-protect.sh:179-180`

**问题描述**：
分支名正则表达式只支持字母数字和连字符，不支持中文或其他 Unicode 字符。如果用户创建中文分支名（如 `cp-中文测试`），正则会失败。

**问题代码**：
```bash
if [[ "$CURRENT_BRANCH" =~ ^cp-[a-zA-Z0-9][-a-zA-Z0-9_]*$ ]] || \
   [[ "$CURRENT_BRANCH" =~ ^feature/[a-zA-Z0-9][-a-zA-Z0-9_/]*$ ]]; then
```

**建议修复**：
```bash
# 支持 Unicode 字符
if [[ "$CURRENT_BRANCH" =~ ^cp-.+$ ]] || \
   [[ "$CURRENT_BRANCH" =~ ^feature/.+$ ]]; then
```

---

### [L2-002] stop-dev.sh - JSON API 输出格式不一致

**文件**：`hooks/stop-dev.sh:68, 79, 149-150` 等多处

**问题描述**：
脚本在不同地方使用不同的 JSON 格式输出阻塞原因：
- 有时用 `jq -n '{"decision": "block", "reason": $reason}'`
- 有时直接 echo 输出

这可能导致调用方解析困难。

**建议修复**：统一使用 JSON API 格式：
```bash
# 统一函数
output_block_json() {
    local reason="$1"
    jq -n --arg reason "$reason" '{"decision": "block", "reason": $reason}'
}
```

---

### [L2-003] sync-version.sh - sed 命令在 YAML 中可能误替换其他字段

**文件**：`scripts/sync-version.sh:87-92`

**问题描述**：
使用 `sed -i "s/^version:.*/version: \"$VERSION\"/"` 替换 version 字段，但这是简单的行替换，可能误替换 YAML 注释中的 version 或其他无关的 version 字段。

**问题代码**：
```bash
sed -i "s/^version:.*/version: \"$VERSION\"/" "$file"
```

**建议修复**：
```bash
# 使用更精确的匹配
sed -i "/^version:/s/:.*/: \"$VERSION\"/" "$file"
# 或使用 yaml 库
```

---

### [L2-004] credential-guard.sh - 路径检查不完整

**文件**：`hooks/credential-guard.sh:16-23`

**问题描述**：
跳过凭据目录检查只检查了 `".credentials"`，但没有检查 `~/.credentials` 或其他常见凭据路径。

**建议修复**：
```bash
# 跳过凭据目录
if [[ "$FILE_PATH" == *".credentials"* ]] || \
   [[ "$FILE_PATH" == "$HOME/.credentials"* ]] || \
   [[ "$FILE_PATH" == *"/.env"* ]]; then
    exit 0
fi
```

---

### [L2-005] skills/dev/SKILL.md - 路径引用可能过时

**文件**：`skills/dev/SKILL.md:193-196`

**问题描述**：
SKILL.md 中引用了 `scripts/devgate/check-dod-mapping.cjs` 等脚本，但这些脚本的实际位置可能因版本更新而变化。没有验证脚本是否存在的机制。

**建议修复**：
在执行前验证依赖存在：
```bash
for script in "scripts/devgate/check-dod-mapping.cjs" "scripts/devgate/scan-rci-coverage.cjs"; do
    if [[ ! -f "$script" ]]; then
        echo "[ERROR] 依赖脚本不存在: $script" >&2
        exit 2
    fi
done
```

---

## L3 记录（不阻塞）

| 编号 | 文件 | 问题 |
|------|------|------|
| L3-001 | hooks/branch-protect.sh:8 | 版本号 v19 在注释中，但实际代码中可能有 v20+ 的修复未同步注释 |
| L3-002 | hooks/stop-dev.sh:22 | `set -euo pipefail` 但在某些分支中使用了 `|| true` 绕过 |
| L3-003 | scripts/devgate/check-dod-mapping.cjs:344-350 | CI 模式下跳过检查的逻辑应该输出更明确的日志级别 |
| L3-004 | skills/dev/SKILL.md:430-435 | 产物检查清单中的 QA 决策路径可能因项目不同而变化 |

---

## 安全问题

本次审查未发现安全问题。所有脚本都正确使用了：
- `set -euo pipefail` 防止静默失败
- 参数验证（jq 解析）
- 凭据检查（credential-guard.sh）

---

## 修复计划

### P0 — 立即修复（今天）
- [ ] [L1-001] branch-protect.sh 数据库检查失败处理
- [ ] [L1-002] stop-dev.sh 并发锁 fallback 路径修复
- [ ] [L1-003] check-dod-mapping.cjs evidence 文件查找逻辑

### P1 — 本周修复
- [ ] [L2-001] branch-protect.sh 分支正则支持中文
- [ ] [L2-004] credential-guard.sh 路径检查完善
- [ ] [L2-005] SKILL.md 路径引用验证

### P2 — 下个迭代
- [ ] [L2-002] stop-dev.sh JSON API 格式统一
- [ ] [L2-003] sync-version.sh sed 命令优化

---

## 审查结论

**Decision**: NEEDS_FIX

**原因**：发现 3 个 L1 阻塞性问题，可能导致分支保护失效或并发控制问题。

**建议**：修复 L1 问题后重新审查。
