# Engine DevGate Scripts (Phase 4)

Phase 4 瘦身后，Engine DevGate 只保留 **1 个 check** + **1 个辅助工具**：

| 脚本 | 作用 | CI 集成 |
|------|------|---------|
| `check-engine-hygiene.cjs` | Engine 卫生检查（4 项） | engine-tests job |
| `../bump-version.sh` | Engine 6 处版本号一键同步 | 人工跑 |

---

## check-engine-hygiene.cjs

### 4 项检查

1. **no-manual-todo** — 扫 `packages/engine/**/*.{md,sh,cjs}` 禁止 `manual:TODO` 占位符（违反 DoD 白名单）
2. **no-dangling-prompt-ref** — 禁止引用已删除的 `packages/engine/skills/dev/prompts/` 路径（Phase 4 删除，应用 `/superpowers:<skill-name>` 替代）
3. **regression-contract-non-empty** — `regression-contract.yaml` 的 `core` / `golden_paths` 不得为空（除非显式 `allow_empty: true`）
4. **version-sync** — Engine 6 处版本号必须一致：
   - `packages/engine/VERSION`
   - `packages/engine/package.json` `.version`
   - `packages/engine/.hook-core-version`
   - `packages/engine/hooks/VERSION`
   - `packages/engine/skills/dev/SKILL.md` frontmatter `version:`
   - `packages/engine/regression-contract.yaml` top-level `version:`

### 用法

```bash
node packages/engine/scripts/devgate/check-engine-hygiene.cjs          # 默认
node packages/engine/scripts/devgate/check-engine-hygiene.cjs --verbose # 详细
```

### 退出码

- `0` — 全 pass
- `1` — 有违规（打印具体 file:line + msg）

### 示例输出

```
[check-engine-hygiene] scanning packages/engine/ ...
[OK] Engine hygiene: all checks passed
```

失败示例：

```
[FAIL] 2 hygiene violation(s):
  [no-manual-todo] packages/engine/skills/dev/scripts/fetch-task-prd.sh:331  Test: manual:TODO
  [version-sync] packages/engine/.hook-core-version:0  .hook-core-version: has "14.17.10" (expected "14.17.11")
```

---

## bump-version.sh

一键同步 Engine 6 处版本号。

### 用法

```bash
bash packages/engine/scripts/bump-version.sh 14.17.12   # 显式版本
bash packages/engine/scripts/bump-version.sh patch      # 自动 patch +1
bash packages/engine/scripts/bump-version.sh minor      # 自动 minor +1
bash packages/engine/scripts/bump-version.sh --dry-run  # 只打印不写
```

## Phase 4 已删除

本目录在 Phase 4 瘦身前有 `check-superpowers-alignment.cjs`（+484 行），用于验证本地复刻的 Superpowers prompt 与 upstream sha256 一致。Phase 4 删除本地复刻（`packages/engine/skills/dev/prompts/`），直接调 `/superpowers:<skill-name>`，runtime 按需加载官方 skill，此 gate 不再需要。
