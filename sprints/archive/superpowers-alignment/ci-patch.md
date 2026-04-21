# Engine 对齐固化 — CI + Hook Patch

> **T5 Agent 产出** — CI workflow + Hook 集成 patch 起草
>
> 起草时间：2026-04-18 (Asia/Shanghai)
> 目标：让 Engine ↔ Superpowers 对齐契约成为合并前必过的 CI Gate

---

## 0. 现状盘点（起草前读一遍）

### 0.1 工作流结构（与 Initiative 文档假设不同）

Cecelia **没有独立的 `engine-ci.yml`**。所有 CI 逻辑统一在 `.github/workflows/ci.yml` 的单个 workflow 内，通过 `changes` job 输出 `engine/brain/workspace` 三个布尔标志，下游 job 用 `if: needs.changes.outputs.engine == 'true'` 做 path-based 过滤。

因此所有新增 Gate **必须嵌入 `ci.yml`**（而不是另建 workflow），并遵守这一 pattern。

```
.github/workflows/
├── auto-version.yml          # 自动版本 bump
├── ci.yml                    # 统一 CI（唯一主 workflow）← 所有改动在此
├── cleanup-merged-artifacts.yml
├── deploy.yml
└── pr-review.yml
```

### 0.2 `.hook-core-version` 实际值（与 Initiative 文档假设不同）

| 文件 | 当前值 | 目标值 | Delta |
|---|---|---|---|
| `packages/engine/package.json` (`.version`) | `14.17.4` | `14.17.5` | +1 patch |
| `packages/engine/package-lock.json` (`.version`) | `14.17.4` | `14.17.5` | +1 patch |
| `packages/engine/VERSION` | `14.17.4` | `14.17.5` | +1 patch |
| `packages/engine/.hook-core-version` | `14.17.4` | `14.17.5` | +1 patch |
| `packages/engine/hooks/VERSION` | `14.17.4` | `14.17.5` | +1 patch |
| `packages/engine/regression-contract.yaml` (`^version:`) | `14.17.4` | `14.17.5` | +1 patch |
| `packages/engine/hook-core/VERSION` | 文件不存在 | — | N/A |

**纠正**：Initiative 文档推定的 `13.7.7 → 14.17.4` 升级差早已在前期 PR 完成。本 Initiative 只需 **bump 一个 patch 到 `14.17.5`**，作为"对齐契约 + DevGate 固化"的发布标记。

### 0.3 现有 version sync 脚本已就位

`packages/engine/ci/scripts/check-version-sync.sh` 已存在，且已覆盖 6 个文件（含 `regression-contract.yaml`）。

已集成到 `ci.yml` 的 `engine-tests` job（line 155-156）：
```yaml
- name: Version Sync
  run: cd packages/engine && bash ci/scripts/check-version-sync.sh
```

**结论**：版本同步 CI 已经是 hard gate，**本 Initiative 不需要新增 version-sync step**，但需要新增 alignment/hygiene step。

### 0.4 engine-tests job 结构（本 Initiative 的注入点）

当前 `engine-tests` job（ci.yml L138-243）已有如下 step 序列：

1. checkout / setup-node / npm ci
2. TypeCheck (tsc --noEmit)
3. Unit Tests (vitest)
4. **Version Sync** ← 已存在
5. Contract Refs Check
6. Dynamic Test Gate
7. Chinese Punctuation Bomb Scan
8. DoD 格式检查
9. DoD BEHAVIOR 命令执行
10. Feature Registry 同步检查
11. E2E Integrity Check

**Initiative 的 2 个新 step（alignment / hygiene）应插入到 step 4 之后，step 5 之前**，与其它 DevGate 形成连续的 gate 链条。

---

## 1. `ci.yml` 改动（唯一 workflow patch）

### 1.1 在 engine-tests job 新增 2 个 step

**插入位置**：`.github/workflows/ci.yml` Line 156 之后（`Version Sync` 步骤之后）、Line 157 之前（`Contract Refs Check` 步骤之前）。

**完整 diff**：

```diff
       - name: Version Sync
         run: cd packages/engine && bash ci/scripts/check-version-sync.sh
+      - name: Install yq (for alignment contract)
+        run: |
+          if ! command -v yq &>/dev/null; then
+            sudo wget -qO /usr/local/bin/yq \
+              https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64
+            sudo chmod +x /usr/local/bin/yq
+          fi
+      - name: Install js-yaml (alignment script dep)
+        run: cd packages/engine && npm install --no-save js-yaml
+      - name: Superpowers Alignment Check
+        run: node packages/engine/scripts/devgate/check-superpowers-alignment.cjs
+      - name: Engine Hygiene Check
+        run: node packages/engine/scripts/devgate/check-engine-hygiene.cjs
       - name: Contract Refs Check
         run: cd packages/engine && bash ci/scripts/check-contract-refs.sh
```

**说明**：
- 沿用 `ci.yml` 既有缩进（6 空格）
- `if: needs.changes.outputs.engine == 'true'` 已由 job 级继承，本级 step 无需重复
- `ubuntu-latest` 已由 job 级继承，`yq` 装到 `/usr/local/bin/` 无权限问题
- `js-yaml` 用 `--no-save` 避免污染 package.json（脚本只需运行时依赖）
- 两个 DevGate 脚本由 T3 Agent 交付，本 patch 只负责挂接

### 1.2 `ci-passed` aggregator 无需改动

`ci-passed` job（L594-624）已经 `needs: [... engine-tests ...]`，新 step 失败会自动向上传播到 engine-tests failure，从而阻断 `ci-passed`。不用改 aggregator。

### 1.3 为什么不新建独立 `engine-alignment-gate` job

**设计权衡**：T5 原方案是独立 job，但与 Cecelia 现有架构冲突：
- 独立 job 需要重复 checkout / setup-node / npm ci（约 40-60 秒开销）
- 独立 job 绕过 `changes.outputs.engine` 过滤，会在非 engine PR 上无谓运行
- 独立 job 名字不在 `ci-passed.needs` 数组中，需要同步修改两处

**现方案**（嵌入 engine-tests）：
- 复用已有 checkout / npm ci（无额外开销）
- 自动只在 engine 变更时运行
- 失败会自然阻塞 `ci-passed`

---

## 2. `.hook-core-version` 改动

```
File: packages/engine/.hook-core-version
---
-14.17.4
+14.17.5
```

**⚠️ 不要单独改此文件**。必须通过以下命令一键同步 6 个文件：

```bash
bash packages/engine/scripts/bump-version.sh 14.17.5
```

该脚本会同步更新：
1. `packages/engine/package.json` (`.version`)
2. `packages/engine/package-lock.json` (`.version` + `packages[''].version`)
3. `packages/engine/VERSION`
4. `packages/engine/.hook-core-version`
5. `packages/engine/hooks/VERSION`
6. `packages/engine/regression-contract.yaml` (`^version:`)

完成后 `ci/scripts/check-version-sync.sh` 才能通过。

---

## 3. `feature-registry.yml` 新增 changelog 条目

**插入位置**：`packages/engine/feature-registry.yml` Line 8 之后（`changelog:` 列表最前面，最新在最上）。

**完整 patch**：

```diff
 changelog:
+  - version: "14.17.5"
+    date: "2026-04-18"
+    change: "chore"
+    description: "Engine ↔ Superpowers 对齐契约固化 + DevGate 防退化。(1) 新增 packages/engine/contracts/superpowers-alignment.yaml 契约（skill 映射 + 本地化修改 allowlist + 来源 commit SHA）；(2) 新增 packages/engine/skills/dev/prompts/ 本地化 Superpowers prompt（来源逐字 + 本地化 diff 记录）；(3) 新增 3 个 DevGate 脚本：check-superpowers-alignment.cjs（契约校验）、check-engine-hygiene.cjs（skills/hooks 目录卫生）、bump-version.sh 已存在无需新增；(4) ci.yml engine-tests job 新增 2 个 step（alignment + hygiene），成为 PR 必过 gate；(5) 为发布标记 patch bump，不改 runtime 行为。"
+    files:
+      - "packages/engine/contracts/superpowers-alignment.yaml"
+      - "packages/engine/skills/dev/prompts/"
+      - "packages/engine/scripts/devgate/check-superpowers-alignment.cjs"
+      - "packages/engine/scripts/devgate/check-engine-hygiene.cjs"
+      - ".github/workflows/ci.yml"
+
   - version: "14.17.4"
     date: "2026-04-18"
     change: "chore"
```

**注意**：现有 changelog 字段名是 `description`（不是 `changes`），action 字段名是 `change`（不是 `breaking`/`author`）。必须与仓库既有格式一致，否则 registry-lint CI 会失败。

---

## 4. `.agent-knowledge/engine.md` 改动建议

现有文件只有 84 行，Engine 版本规则在 L59-78。补充第 6 处版本检查、推荐 bump 工具、CI Gate 说明。

```diff
@@ -59,19 +59,29 @@
 ## Engine 版本规则

 Engine Skills/Hooks 改动的三要素：

 **1. PR title 含 `[CONFIG]`**（触发 engine-ci.yml）

-**2. 版本 bump 5 个文件**（`packages/engine/ci/scripts/check-version-sync.sh` 强制校验）：
+**2. 版本 bump 6 个文件**（`packages/engine/ci/scripts/check-version-sync.sh` 强制校验）：
 ```
 packages/engine/package.json       (.version 字段)
 packages/engine/package-lock.json
 packages/engine/VERSION
 packages/engine/.hook-core-version
+packages/engine/hooks/VERSION
 packages/engine/regression-contract.yaml
 ```

+**推荐工具（一键同步 6 个文件）**：
+```bash
+bash packages/engine/scripts/bump-version.sh 14.17.5   # 指定精确版本
+bash packages/engine/scripts/bump-version.sh patch     # 自动 patch+1
+```
+
+**CI Gate**：`ci.yml` engine-tests job 的 `Version Sync` step 会在 PR 上强制校验
+6 处同步，失败会阻塞 `ci-passed` aggregator。
+
+从 14.17.5 起，engine-tests job 还会额外跑 Superpowers 对齐校验和
+Engine 目录卫生校验（见 §3 feature-registry.yml 14.17.5 条目）。
+
 **3. 文档更新**：
 - `packages/engine/features/feature-registry.yml` — 新增 changelog 条目
 - 运行 `bash packages/engine/scripts/generate-path-views.sh` 重新生成路径视图

 commit 前缀 `[CONFIG]` 触发 engine-ci.yml。
```

**关键修正**：
- 原文件说"5 个文件"是错误描述，实际 `check-version-sync.sh` 已覆盖 6 个文件（含 `hooks/VERSION`）
- 补齐 `packages/engine/hooks/VERSION` 一行
- 加入 `bump-version.sh` 推荐命令（官方工具，不应让人手工逐个改）
- 加入新 CI Gate 说明（alignment / hygiene）

---

## 5. Pre-commit Hook 新增（可选，本 Initiative 不强制）

### 5.1 评估结论：不引入新的 Claude settings.json hook

理由：
1. Engine 没有用 husky/git-hooks 驱动的 pre-commit 机制，只有 `hooks/pre-push.sh` → `scripts/quickcheck.sh` 本地预检（通过 Claude Code settings.json 的 PrePush hook 调用）
2. `quickcheck.sh` 已经包含 DoD 未勾选守卫，结构良好，在 push 前跑 version sync 检查成本低
3. 强行在 commit 阶段阻止会干扰 `bump-version.sh` 运行到中途的中间状态（脚本非原子，逐个文件写）

### 5.2 唯一建议：在 quickcheck.sh 加入 version sync 预检

**插入位置**：`scripts/quickcheck.sh` DoD 未勾选守卫之后、包级 vitest 之前。

```bash
# ─── Engine Version Sync 预检（Engine 变更时本地拦截）───────────
ENGINE_CHANGED=$(echo "$CHANGED_FILES" | grep -c '^packages/engine/' 2>/dev/null || echo 0)
if [[ "$ENGINE_CHANGED" -gt 0 ]]; then
    echo "🔍 Engine 变更检测 → 本地跑 version sync 预检"
    if ! (cd packages/engine && bash ci/scripts/check-version-sync.sh); then
        echo -e "${RED}❌ Engine 版本不同步，push 已阻止${RESET}"
        echo "   修复：bash packages/engine/scripts/bump-version.sh <version>"
        PASS=false
    fi
fi
```

**是否必须**：否。CI 已经有 hard gate，本地预检只是"早失败早告知"。T5 不建议列为本 Initiative 的必做项，留给后续 Engine 改进 PR 顺手处理。

---

## 6. `check-version-sync.sh` 改动（无需）

`packages/engine/ci/scripts/check-version-sync.sh` 已覆盖全部 6 个文件（见 §0.3）。本 Initiative **不需要改该脚本**。

唯一建议：脚本 L119-125 的"修复方法"帮助文字提到"一键同步所有 6 个文件"，说明作者已经意识到 6 个文件。可改 `.agent-knowledge/engine.md` 的说法保持一致（见 §4）。

---

## 7. 应用顺序（Initiative Owner 执行清单）

按以下顺序 commit，每步验证后再进入下一步：

### Step 1：安装 3 个 DevGate 脚本（T3 产出）
```bash
# T3 Agent 已交付到 /Users/administrator/claude-output/engine-alignment-initiative/scripts/
cp ~/claude-output/engine-alignment-initiative/scripts/check-superpowers-alignment.cjs \
   packages/engine/scripts/devgate/
cp ~/claude-output/engine-alignment-initiative/scripts/check-engine-hygiene.cjs \
   packages/engine/scripts/devgate/
chmod +x packages/engine/scripts/devgate/*.cjs
# 本地验证
node packages/engine/scripts/devgate/check-superpowers-alignment.cjs
node packages/engine/scripts/devgate/check-engine-hygiene.cjs
```

### Step 2：安装 alignment 契约 + prompts（T1/T2 产出）
```bash
mkdir -p packages/engine/contracts packages/engine/skills/dev/prompts
cp ~/claude-output/engine-alignment-initiative/prompt-localization-manifest.yaml \
   packages/engine/contracts/superpowers-alignment.yaml
cp -r ~/claude-output/engine-alignment-initiative/prompts/* \
   packages/engine/skills/dev/prompts/
```

### Step 3：bump 版本到 14.17.5
```bash
bash packages/engine/scripts/bump-version.sh 14.17.5
bash packages/engine/ci/scripts/check-version-sync.sh  # 必须全绿
```

### Step 4：更新 feature-registry.yml
手动在 `packages/engine/feature-registry.yml` 顶部加入 §3 的 14.17.5 条目。

### Step 5：更新 ci.yml
按 §1.1 diff 在 engine-tests job 插入 4 个 step（yq install / js-yaml install / alignment / hygiene）。

### Step 6：更新 .agent-knowledge/engine.md
按 §4 diff 更新。

### Step 7：本地全链路验证
```bash
# 模拟 CI engine-tests 关键 step
cd packages/engine
bash ci/scripts/check-version-sync.sh                            # step 4
node scripts/devgate/check-superpowers-alignment.cjs             # 新 step
node scripts/devgate/check-engine-hygiene.cjs                    # 新 step
bash ci/scripts/check-contract-refs.sh                           # step 5
# Feature Registry 同步检查（本地模拟）
git diff --name-only origin/main...HEAD | grep -q 'feature-registry.yml' && echo "OK"
```

### Step 8：提交 + push
```bash
git add -A
git commit -m "[CONFIG] feat(engine): 14.17.5 — Superpowers 对齐契约 + DevGate 防退化"
git push -u origin cp-<timestamp>-engine-alignment
gh pr create --title "[CONFIG] feat(engine): Engine ↔ Superpowers 对齐固化 (14.17.5)" ...
```

### Step 9：push 后看 CI
- `ci-passed` 必须 green
- engine-tests 所有 step 必须 pass（关注新的 Superpowers Alignment Check / Engine Hygiene Check）
- auto-version.yml 可能会在 merge 后触发，需确认不会覆盖 14.17.5

---

## 8. 验证清单（合并前 sign-off）

### 8.1 版本同步
- [ ] `packages/engine/package.json` `.version` = `14.17.5`
- [ ] `packages/engine/package-lock.json` `.version` + `packages[''].version` = `14.17.5`
- [ ] `packages/engine/VERSION` = `14.17.5`
- [ ] `packages/engine/.hook-core-version` = `14.17.5`
- [ ] `packages/engine/hooks/VERSION` = `14.17.5`
- [ ] `packages/engine/regression-contract.yaml` `^version: 14.17.5`
- [ ] `bash packages/engine/ci/scripts/check-version-sync.sh` 输出 "✅ 所有版本文件同步"

### 8.2 CI workflow 挂接
- [ ] `.github/workflows/ci.yml` engine-tests job 包含 `Superpowers Alignment Check` step
- [ ] `.github/workflows/ci.yml` engine-tests job 包含 `Engine Hygiene Check` step
- [ ] 两个 step 位于 `Version Sync` 之后、`Contract Refs Check` 之前
- [ ] yq + js-yaml 安装 step 存在
- [ ] `ci-passed` aggregator 的 `needs` 数组包含 `engine-tests`（已有，无需改）

### 8.3 Registry 同步
- [ ] `packages/engine/feature-registry.yml` 最新条目 version = `14.17.5`
- [ ] 条目 date = `2026-04-18`
- [ ] 条目 files 数组列出所有新增/修改文件（≥4 项）
- [ ] `node scripts/registry-lint.mjs`（repo 根）通过

### 8.4 DevGate 脚本可执行
- [ ] `packages/engine/scripts/devgate/check-superpowers-alignment.cjs` 存在且 exit 0
- [ ] `packages/engine/scripts/devgate/check-engine-hygiene.cjs` 存在且 exit 0
- [ ] 脚本在 `ubuntu-latest` + Node 22 环境下能跑（通过 CI 验证）

### 8.5 防退化实验
在 PR 分支上故意破坏契约，CI 必须红（三选一验证）：
- [ ] 修改 `packages/engine/skills/dev/prompts/` 下某 prompt 的 "逐字搬运" 区块 → alignment CI 红
- [ ] 新增 `packages/engine/skills/temp-draft/` 目录 → hygiene CI 红
- [ ] 故意把 `.hook-core-version` 改回 `14.17.4` → version sync CI 红

---

## 9. 已知风险 + 观察点

### 9.1 auto-version.yml 与手动 bump 冲突

`.github/workflows/auto-version.yml` 会在 merge 后自动 bump 版本。如果手动已 bump 到 14.17.5，auto-version 可能再 bump 到 14.17.6。

**缓解**：提前 read `auto-version.yml` 看 bump 策略。如只在 brain/ 变更时触发，则对 engine-only PR 无影响。Initiative owner 合并前需验证一次。

### 9.2 引入 js-yaml CI 安装成本

`npm install --no-save js-yaml` 约 3-5 秒。如果 alignment 脚本能自己解析 yaml（比如用 `JSON.parse(yq eval -o=json)` 管道），可去掉这一 step。**由 T3 决定脚本实现方式**，T5 这里给出兼容性最高的默认方案。

### 9.3 hook-core/VERSION 文件不存在

`check-version-sync.sh` L68-76 包含 `hook-core/VERSION` 检查，但该文件不存在，脚本会跳过（`if [[ -f "hook-core/VERSION" ]]`）。属于历史遗留结构，不影响 6 文件同步。**本 Initiative 不删除该检查逻辑**（保留兼容性）。

### 9.4 现有 pre-push hook 冲突风险

`hooks/pre-push.sh` 调用 `scripts/quickcheck.sh`，后者已 `flock` 互斥锁。§5.2 建议新增的 version sync 预检会在锁内串行执行，不会产生新的并发风险。

---

## 10. 返回给 Initiative Owner 的交接

本 patch 文档已覆盖：
1. ✅ `ci.yml` engine-tests job 的 4 个新 step（yq + js-yaml 安装 + alignment + hygiene）
2. ✅ `.hook-core-version` 从 14.17.4 → 14.17.5（通过 bump-version.sh 一键同步 6 个文件）
3. ✅ `feature-registry.yml` 14.17.5 changelog 条目（符合现有格式）
4. ✅ `.agent-knowledge/engine.md` 修正 "5 个文件" → "6 个文件" + 补 bump-version.sh 推荐
5. ⏭️ pre-commit hook（评估后不引入，避免 over-engineering）
6. ⏭️ `check-version-sync.sh` 不改（已覆盖 6 文件）

依赖其他 Agent 交付：
- T1：`packages/engine/skills/dev/prompts/` 目录结构和内容（本地化后的 Superpowers prompts）
- T2：`packages/engine/contracts/superpowers-alignment.yaml`（本地化 manifest）
- T3：`check-superpowers-alignment.cjs` + `check-engine-hygiene.cjs` 两个 DevGate 脚本
- T4：Initiative Owner 统一把 T1-T4 产出 + 本 patch 合并成一个 PR

**Initiative Owner 下一步动作**：按 §7 的 9 步清单逐步执行，遇到任一步 CI 红则停下排查。
