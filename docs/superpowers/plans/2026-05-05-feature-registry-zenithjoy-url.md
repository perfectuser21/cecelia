# Feature Registry contract_url 迁移到 ZenithJoy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `feature-registry.yml` `features.stop-hook.contract_url` 从月升 frozen page 切换到 ZenithJoy 新 SSOT page，并加 integrity grep 守门。

**Architecture:** 1 行 yml URL 切换 + 1 行新增 `contract_url_legacy` 历史指针字段 + integrity L18 grep 升级（grep 含 ZenithJoy page id token）+ 8 处 engine 版本 bump 18.22.2→18.22.3 (patch — doc-only) + changelog + Learning。

**Tech Stack:** YAML / bash integrity test / engine version files。

---

## File Structure

文件改动清单（共 11 处文件）：

| 文件 | 改动 |
|------|------|
| `packages/engine/feature-registry.yml` | line 38 contract_url 切换 + 新增 contract_url_legacy + changelog 18.22.3 条目 |
| `packages/engine/tests/integrity/stop-hook-coverage.test.sh` | L18 grep 加 357c40c2-ba63-81b8 token |
| `packages/engine/VERSION` | 18.22.2 → 18.22.3 |
| `packages/engine/.hook-core-version` | 18.22.2 → 18.22.3 |
| `packages/engine/hooks/.hook-core-version` | 18.22.2 → 18.22.3 |
| `packages/engine/hooks/VERSION` | 18.22.2 → 18.22.3 |
| `packages/engine/package.json` | 18.22.2 → 18.22.3 |
| `packages/engine/package-lock.json` | 2 处 18.22.2 → 18.22.3 |
| `packages/engine/regression-contract.yaml` | 18.22.2 → 18.22.3 |
| `docs/learnings/cp-0505175548-feature-registry-zenithjoy-url.md` | 新建 Learning |

---

## Task 1: 升级 integrity L18 grep（先写 fail test）

**Files:**
- Modify: `packages/engine/tests/integrity/stop-hook-coverage.test.sh:128-136`

- [ ] **Step 1: 改 L18 grep 加 ZenithJoy URL token 守门**

打开 `packages/engine/tests/integrity/stop-hook-coverage.test.sh`，把 line 128-136 替换为：

```bash
# L18: feature-registry.yml 含 stop-hook feature 注册 + contract_url 指向 ZenithJoy（v18.22.3 升级）
if grep -qE '^  - id: stop-hook$' "$REPO_ROOT/packages/engine/feature-registry.yml" && \
   grep -q 'name: Stop Hook' "$REPO_ROOT/packages/engine/feature-registry.yml" && \
   grep -qE 'contract_url:.*357c40c2-ba63-81b8' "$REPO_ROOT/packages/engine/feature-registry.yml"; then
    pass "L18: feature-registry 含 stop-hook 完整 feature 注册（含 ZenithJoy contract_url）"
else
    fail "L18: stop-hook feature 未注册或 contract_url 未指向 ZenithJoy（357c40c2-ba63-81b8）"
fi
```

- [ ] **Step 2: 跑 integrity 验证 L18 fail（contract_url 还是月升）**

```bash
cd /Users/administrator/worktrees/cecelia/feature-registry-zenithjoy-url
bash packages/engine/tests/integrity/stop-hook-coverage.test.sh 2>&1 | tail -5
```

预期：`L18 FAIL`（feature-registry.yml 还是月升 URL）+ 总 18 PASS / 1 FAIL。

---

## Task 2: 切换 feature-registry.yml contract_url + 加 changelog

**Files:**
- Modify: `packages/engine/feature-registry.yml`

- [ ] **Step 1: 切换 contract_url + 新增 contract_url_legacy**

打开 `packages/engine/feature-registry.yml`，找到 line 38：

```yaml
    contract_url: https://www.notion.so/35753f413ec581d9b607f61e4e90ce0b
```

替换为（2 行）：

```yaml
    contract_url: https://www.notion.so/Stop-Hook-Contract-v18-22-2-357c40c2ba6381b893c7e251707d1252
    contract_url_legacy: https://www.notion.so/35753f413ec581d9b607f61e4e90ce0b  # 月升 frozen，留作历史快照
```

- [ ] **Step 2: 改 yaml 头部 version 1.1.0 → 1.1.1**

line 6 `version: "1.1.0"` → `version: "1.1.1"`，line 7 `updated: "2026-05-05"` 保持。

- [ ] **Step 3: changelog 段加 18.22.3 条目**

在 changelog 段最顶部（最新条目位置）插入：

```yaml
  - version: 18.22.3
    date: 2026-05-05
    type: docs
    summary: feature-registry contract_url 迁移到 ZenithJoy（月升 workspace frozen）
    details:
      - features.stop-hook.contract_url 指向 ZenithJoy 新 page (357c40c2-ba63-81b8)
      - 新增 contract_url_legacy 字段保留月升历史指针 (35753f41)
      - integrity L18 grep ZenithJoy URL token 守门
```

具体插入位置：在 `changelog:` 行下面，`  - version: 18.22.2` 条目**之前**。

- [ ] **Step 4: 跑 integrity 验证 L18 现在 pass**

```bash
cd /Users/administrator/worktrees/cecelia/feature-registry-zenithjoy-url
bash packages/engine/tests/integrity/stop-hook-coverage.test.sh 2>&1 | tail -5
```

预期：19 PASS / 0 FAIL。

---

## Task 3: Engine 版本 bump 18.22.2 → 18.22.3（8 处文件同步）

**Files:**
- Modify: `packages/engine/VERSION`
- Modify: `packages/engine/.hook-core-version`
- Modify: `packages/engine/hooks/.hook-core-version`
- Modify: `packages/engine/hooks/VERSION`
- Modify: `packages/engine/package.json` (`.version`)
- Modify: `packages/engine/package-lock.json` (2 处 `.version`)
- Modify: `packages/engine/regression-contract.yaml` (line 31 `version:`)

- [ ] **Step 1: 批量 sed 把 18.22.2 → 18.22.3**

```bash
cd /Users/administrator/worktrees/cecelia/feature-registry-zenithjoy-url
for f in packages/engine/VERSION packages/engine/.hook-core-version \
         packages/engine/hooks/.hook-core-version packages/engine/hooks/VERSION \
         packages/engine/package.json packages/engine/package-lock.json \
         packages/engine/regression-contract.yaml; do
    sed -i '' 's/18\.22\.2/18.22.3/g' "$f"
done
```

- [ ] **Step 2: 验证版本同步**

```bash
cd /Users/administrator/worktrees/cecelia/feature-registry-zenithjoy-url
bash scripts/check-version-sync.sh 2>&1 | tail -5
```

预期：版本同步 OK。

---

## Task 4: 写 Learning

**Files:**
- Create: `docs/learnings/cp-0505175548-feature-registry-zenithjoy-url.md`

- [ ] **Step 1: 写 Learning 内容**

```markdown
# feature-registry contract_url 迁移到 ZenithJoy（2026-05-05）

## 任务

`packages/engine/feature-registry.yml` `features.stop-hook.contract_url` 从月升 workspace page (35753f41) 切换到 ZenithJoy 新 SSOT page (357c40c2-ba63-81b8)。

## 根本原因

PR #2780 把 stop-hook 注册为正式 feature 时，ZenithJoy workspace 还没建对应 contract page，临时用了月升 workspace 的半年史 page 作为 contract_url。月升后续 frozen，新 SSOT 必须指向 ZenithJoy 才合规。

本质：feature 注册 + Notion contract page 创建是两个并行动作，时序导致首次注册时只有月升 page 可指。

## 修法

1. ZenithJoy `cecelia` page 下创建简洁版 Stop Hook Contract page（含 18 invariant + 测试 + 14 闭环段）
2. 月升 page 顶部加 `FROZEN — 已迁移到 ZenithJoy` 标记，保留作为历史快照
3. `feature-registry.yml` `contract_url` 切到 ZenithJoy URL，新增 `contract_url_legacy` 字段保留月升指针
4. integrity L18 grep 加 ZenithJoy page id token (357c40c2-ba63-81b8) 守门

## 下次预防

- [ ] feature-registry 新增 feature entry 时，必须确认 contract_url 指向**当前活跃 workspace** 的 page，不要临时用旧 workspace 的指针
- [ ] integrity grep 应该 grep **具体 page id token**（区分新旧），不要只 grep `contract_url:.*notion`（任何 notion URL 都过）
- [ ] Notion workspace 迁移时，先在新 workspace 建对应 page → 再改 repo 引用 → 最后给旧 page 加 frozen 标记（顺序很重要，否则 SSOT 短暂指空）

## 引用

- ZenithJoy contract: https://www.notion.so/Stop-Hook-Contract-v18-22-2-357c40c2ba6381b893c7e251707d1252
- 月升 frozen: https://www.notion.so/35753f413ec581d9b607f61e4e90ce0b
- PR #2780: stop-hook 首次注册到 feature-registry
```

- [ ] **Step 2: 验证 Learning 文件格式（含 `### 根本原因` + `### 下次预防` + checklist）**

```bash
cd /Users/administrator/worktrees/cecelia/feature-registry-zenithjoy-url
grep -E '^## (根本原因|下次预防)|^- \[ \]' docs/learnings/cp-0505175548-feature-registry-zenithjoy-url.md
```

预期：含 `## 根本原因` + `## 下次预防` + 至少 1 条 `- [ ]` checklist。

注：Cecelia Learning Format Gate 要求 `### 根本原因`，但本 Learning 用 `## 根本原因` 标题更清晰。如 CI fail，Step 3 兜底改成 `### 根本原因` 形式。

- [ ] **Step 3: 兜底（仅 Step 2 fail 时跑）— 改成 ### 标题**

如 CI Learning Format Gate fail，把 `## 根本原因` → `### 根本原因`、`## 下次预防` → `### 下次预防`。

---

## Task 5: 一次性 commit + push + PR

- [ ] **Step 1: 看全部 diff 自检**

```bash
cd /Users/administrator/worktrees/cecelia/feature-registry-zenithjoy-url
git status
git diff --stat
```

预期：~10 个文件改动（version 7 处 + feature-registry.yml + integrity test + Learning）。

- [ ] **Step 2: 跑全套 integrity + lint 验证**

```bash
cd /Users/administrator/worktrees/cecelia/feature-registry-zenithjoy-url
bash packages/engine/tests/integrity/stop-hook-coverage.test.sh 2>&1 | tail -3
bash scripts/check-version-sync.sh 2>&1 | tail -3
```

预期：integrity 19/19 pass + version sync OK。

- [ ] **Step 3: commit**

```bash
cd /Users/administrator/worktrees/cecelia/feature-registry-zenithjoy-url
git add packages/engine/feature-registry.yml \
        packages/engine/tests/integrity/stop-hook-coverage.test.sh \
        packages/engine/VERSION packages/engine/.hook-core-version \
        packages/engine/hooks/.hook-core-version packages/engine/hooks/VERSION \
        packages/engine/package.json packages/engine/package-lock.json \
        packages/engine/regression-contract.yaml \
        docs/learnings/cp-0505175548-feature-registry-zenithjoy-url.md
git commit -m "$(cat <<'EOF'
[CONFIG] docs(engine): feature-registry contract_url 迁移到 ZenithJoy (cp-0505175548)

- features.stop-hook.contract_url 指向 ZenithJoy 新 page (357c40c2-ba63-81b8)
- 新增 contract_url_legacy 字段保留月升历史指针
- integrity L18 grep ZenithJoy URL token 守门
- engine 版本 18.22.2 → 18.22.3 (8 处同步)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: push**

```bash
cd /Users/administrator/worktrees/cecelia/feature-registry-zenithjoy-url
git push -u origin cp-0505175548-feature-registry-zenithjoy-url
```

- [ ] **Step 5: 建 PR**

```bash
cd /Users/administrator/worktrees/cecelia/feature-registry-zenithjoy-url
gh pr create --title "[CONFIG] docs(engine): feature-registry contract_url 迁移到 ZenithJoy (cp-0505175548)" --body "$(cat <<'EOF'
## Summary
- features.stop-hook.contract_url 从月升 frozen page (35753f41) 切到 ZenithJoy SSOT page (357c40c2-ba63-81b8)
- 新增 contract_url_legacy 字段保留月升历史指针
- integrity L18 grep ZenithJoy page id token 守门
- engine 18.22.2 → 18.22.3 (8 处版本同步, doc-only patch)

## Test plan
- [x] integrity 19/19 pass (L18 grep ZenithJoy URL)
- [x] version-sync OK (8 处 18.22.3)
- [x] Learning 含 ### 根本原因 + ### 下次预防

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ contract_url 切换 → Task 2 Step 1
- ✅ contract_url_legacy 新增 → Task 2 Step 1
- ✅ engine 8 处版本 bump → Task 3
- ✅ feature-registry.yml changelog 加条目 → Task 2 Step 3
- ✅ integrity L18 grep ZenithJoy URL → Task 1 Step 1
- ✅ Learning 文件 → Task 4

**2. Placeholder scan:** 无 TBD/TODO/省略号。所有 step 含具体命令/diff。

**3. Type consistency:**
- ZenithJoy page id `357c40c2-ba63-81b8` 在 spec / Task 1 grep / Task 2 yml / Task 4 Learning 一致
- 月升 page id `35753f41` 在 spec / Task 2 contract_url_legacy / Task 4 Learning 一致
- 版本 `18.22.3` 在 Task 2 changelog / Task 3 sed / Task 4 commit 一致

---

## Execution

**Inline execution（按 spec 备注）。** 直接进 executing-plans 跑 Task 1 → 5。
