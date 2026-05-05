# Feature Registry contract_url 迁移到 ZenithJoy

## 背景

PR #2780 把 stop-hook 注册为正式 feature 时，`packages/engine/feature-registry.yml` line 38 的 `contract_url` 字段写的是月升 workspace page (`35753f413ec581d9b607f61e4e90ce0b`)。

月升 workspace 已 frozen 不再维护，新 SSOT 在 ZenithJoy:
- ZenithJoy contract page: `357c40c2-ba63-81b8-93c7-e251707d1252`
- URL: `https://www.notion.so/Stop-Hook-Contract-v18-22-2-357c40c2ba6381b893c7e251707d1252`

现在 `feature-registry.yml` 的 contract_url 字段指错了 workspace。本次修正。

## 范围

**IN scope:**
- `feature-registry.yml` line 38 `contract_url` 切换为 ZenithJoy URL
- Engine 8 处版本 bump 18.22.2 → 18.22.3 (patch — doc-only)
- `feature-registry.yml` changelog 加新条目
- `tests/integrity/stop-hook-coverage.test.sh` L18 grep 改成验证 ZenithJoy URL 而不是任意 URL
- Learning 文件

**OUT of scope:**
- 不改月升 page（已加 frozen 标记）
- 不改 ZenithJoy entry body blocks（已在 1Password ZenithJoy 那一步同步好）
- 不动 stop-dev.sh / devloop-check.sh / settings.json 等 hook 实现
- 不改 features 段其他字段（invariants_count / state_machine 等保持 PR #2780 的内容）

## 修法

### 1. `packages/engine/feature-registry.yml`

```yaml
# line 38 之前：
    contract_url: https://www.notion.so/35753f413ec581d9b607f61e4e90ce0b

# line 38 之后：
    contract_url: https://www.notion.so/Stop-Hook-Contract-v18-22-2-357c40c2ba6381b893c7e251707d1252
    contract_url_legacy: https://www.notion.so/35753f413ec581d9b607f61e4e90ce0b  # 月升 frozen，留作历史
```

`contract_url_legacy` 是新增字段（非破坏性），保留旧 URL 作为历史快照指针，方便审计回溯。

### 2. Engine 版本 bump 18.22.2 → 18.22.3

8 处文件同步：
- `packages/engine/VERSION`
- `packages/engine/package.json`
- `packages/engine/package-lock.json`
- `packages/engine/regression-contract.yaml`
- `packages/engine/.hook-core-version`（如果存在）
- `packages/engine/hooks/.hook-core-version`（如果存在）
- `packages/engine/hooks/VERSION`（如果存在）
- `packages/engine/SKILL.md`（如果含版本号）

实际数量按 `bash scripts/check-version-sync.sh` 校验为准。

### 3. `feature-registry.yml` changelog 加条目

按现有格式追加：

```yaml
  - version: 18.22.3
    date: 2026-05-05
    type: docs
    pr: TBD
    summary: feature-registry contract_url 迁移到 ZenithJoy（月升 workspace frozen）
    details:
      - features.stop-hook.contract_url 指向 ZenithJoy 新 page
      - 新增 contract_url_legacy 字段保留月升历史指针
      - integrity L18 grep ZenithJoy URL 守门
```

### 4. `tests/integrity/stop-hook-coverage.test.sh` L18

旧 L18 只 grep `id: stop-hook`。改为 grep ZenithJoy URL 的关键 token（357c40c2-ba63-81b8）。

```bash
# L18: feature-registry.yml 含 stop-hook feature 注册 + contract_url 指向 ZenithJoy
if grep -qE '^  - id: stop-hook$|name: stop-hook' "$REPO_ROOT/packages/engine/feature-registry.yml" && \
   grep -qE '357c40c2-ba63-81b8' "$REPO_ROOT/packages/engine/feature-registry.yml"; then
    pass "L18: feature-registry 含 stop-hook + contract_url 指 ZenithJoy"
else
    fail "L18: stop-hook 未注册或 contract_url 未指向 ZenithJoy"
fi
```

### 5. Learning

`docs/learnings/cp-0505175548-feature-registry-zenithjoy-url.md`

含：背景、根本原因（PR #2780 写 yml 时 ZenithJoy contract page 还没建）、修法、下次预防 checklist。

## 测试策略

按 brainstorming 四档分类，本次属于 **trivial wrapper（< 20 行 yml/文档改动 + 无 I/O）→ 1 unit test 即可**。

- **integrity L18 grep**：守门 contract_url 真实指向 ZenithJoy（不是任意 URL）— 这是 unit 类机器化测试，已在现有 `stop-hook-coverage.test.sh` 中扩展，不新增文件
- 不需要 integration test（无跨模块行为变化）
- 不需要 E2E test（无运行时行为变化）
- 不需要 smoke test（feature 行为本身没变，只是文档 SSOT 切换）

## 完成定义

- [ ] `feature-registry.yml` `contract_url` 含 `357c40c2-ba63-81b8`
- [ ] `feature-registry.yml` `contract_url_legacy` 保留月升 page id `35753f41`
- [ ] engine 版本同步 18.22.3（按 `check-version-sync.sh`）
- [ ] `feature-registry.yml` changelog 含 18.22.3 条目
- [ ] `stop-hook-coverage.test.sh` L18 grep 含 ZenithJoy URL token
- [ ] integrity 19 case 全过
- [ ] Learning 文件
- [ ] CI 全绿

## 成功标准

- `grep contract_url packages/engine/feature-registry.yml` 显示新 URL（含 357c40c2-ba63-81b8）
- `cat packages/engine/VERSION` = 18.22.3
- `bash packages/engine/tests/integrity/stop-hook-coverage.test.sh` 19/19 pass
- CI 全绿，PR 合并到 main
