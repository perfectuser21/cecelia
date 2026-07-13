# Design: pre-commit hook 收紧匹配 + 接入 CI

## 背景

PR #3666（pre-commit hook 对 zenithjoy-skills 仓库例外放行）的 final review 提了两个 nice-to-have：
1. `packages/engine/hooks/pre-commit` 里 `[[ "$ORIGIN_URL" == *"zenithjoy-skills"* ]]` 是子串匹配，未来若出现 `zenithjoy-skills-v2` 之类同前缀仓库会被误豁免。
2. `tests/hooks/test-pre-commit.sh` 没有接入任何 CI workflow，只能手动跑，回归全靠自觉。

## 方案

### 1. 收紧匹配

把子串匹配改成锚定 basename 的正则，同时兼容带 `.git` 后缀和不带的两种 URL 形式：

```bash
if [[ "$ORIGIN_URL" =~ /zenithjoy-skills(\.git)?/?$ ]]; then
```

`zenithjoy-skills-v2.git` 不会匹配这个正则（因为 `-v2` 挡在 `zenithjoy-skills` 和行尾之间），`https://github.com/x/zenithjoy-skills.git` 和 `git@github.com:x/zenithjoy-skills` 都能匹配。

### 2. 接入 CI（不新增 workflow 文件）

调研发现：CI 里已经有 `engine-tests-shell` job（`.github/workflows/ci.yml`），它会自动 glob 扫描并运行：
- `packages/engine/tests/unit/*.test.sh`
- `packages/engine/tests/integration/*.test.sh`
- `packages/engine/tests/integrity/*.test.sh`

这个 job 已经是 `ci-passed` 聚合闸门的必过项之一（`needs: [...engine-tests-shell...]`），且已有触发条件 `needs.changes.outputs.engine == 'true' || github.ref == 'refs/heads/main'`——任何改 `packages/engine/**` 的 PR 都会触发它。

`packages/engine/tests/integration/` 下已有同类 hook 测试（`dev-mode-tool-guard.test.sh`、`worktree-checkout-guard.test.sh`），命名规范是 `<subject>.test.sh`。

**不新建 workflow 文件**，而是把 `tests/hooks/test-pre-commit.sh` 迁移到 `packages/engine/tests/integration/pre-commit.test.sh`（改名匹配 `.test.sh` glob 后缀），让它被现有 `engine-tests-shell` job 自动捡起、自动成为 `ci-passed` 必过项的一部分。这比新增一条平行 workflow 更简单、风险更低（不用碰 `ci.yml` 里那个巨大的 `needs` 数组），且符合"跟随既有模式"的原则。

## 备选方案（未采用）

**新增独立 `.github/workflows/ci-hooks-tests.yml`**——被否决：需要额外把新 job 加进 `ci-passed` 的 `needs` 数组才能真正"卡住合并"（否则只是空转不拦人），这是对共享巨型文件的手术式编辑，风险明显高于复用已有 glob 机制。

## 影响范围

- `packages/engine/hooks/pre-commit`：只改一行判断逻辑，其余不变
- `tests/hooks/test-pre-commit.sh` → 迁移到 `packages/engine/tests/integration/pre-commit.test.sh`（原路径删除，`feature-registry.yml` 里的 files 引用需同步更新）
- 不改动 `.github/workflows/ci.yml`

## 测试策略

在迁移后的 `pre-commit.test.sh` 里新增第7条用例：`zenithjoy-skills-v2` 仓库应仍被拒绝（验证收紧生效，不误伤真正的 zenithjoy-skills）。7条全过。
