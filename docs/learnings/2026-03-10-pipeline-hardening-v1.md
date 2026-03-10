---
id: learning-pipeline-hardening-v1
version: 1.0.0
created: 2026-03-10
updated: 2026-03-10
changelog:
  - 1.0.0: 初始版本
---

# Learning: V1 Pipeline Hardening — 本地门禁升级

**PR**: #754
**分支**: cp-03101124-pipeline-hardening-v1
**日期**: 2026-03-10

---

## 做了什么

将 /dev 工作流的 Step 7 升级为真正的 Pre-Push Gate，并强化 Step 9 的 CI 失败处理规则。

## 技术决策

### local-precheck.sh 的设计选择

**Brain 改动检测用 `wc -l` 而非 `grep -c`**

- `grep -c` 返回 0 匹配时 exit code=1，触发 `|| echo 0`，导致变量包含两行 `"0\n0"`
- `[[: 0\n0: syntax error in expression`
- 修复：改用 `grep | wc -l | tr -d ' '`，`wc -l` 始终 exit 0

**version-sync 用 Node.js 内联脚本而非 grep -P**

- macOS 的 `grep -P` 不支持，`check-version-sync.sh` 在 macOS 上 `⚠️ skipping`
- 用 `node -e` 内联 JavaScript 做正则匹配，跨平台兼容

### Engine CI 的 version-sync 要求更多文件

bumping `packages/engine/package.json` 时，以下文件都要同步：
- `package.json` + `package-lock.json`（已知）
- `VERSION` ← 容易漏
- `.hook-core-version` ← 容易漏
- `regression-contract.yaml`（`version: "x.y.z"` 格式） ← 容易漏

### Engine CI Config Audit + Impact Check 触发条件

修改 `packages/engine/skills/` 时：
- PR title 必须包含 `[CONFIG]` 或 `[INFRA]` 标签
- `packages/engine/features/feature-registry.yml` 必须更新

## 下次预防

| 场景 | 操作 |
|------|------|
| Engine skills 改动 | PR title 加 `[CONFIG]`，更新 feature-registry.yml，bumping 5 个版本文件 |
| Brain 改动 | 跑 `bash scripts/local-precheck.sh --force` 验证 facts/version/manifest |
| grep -c 返回值 | 改用 `grep | wc -l`，避免 exit code 污染 OR 运算 |
