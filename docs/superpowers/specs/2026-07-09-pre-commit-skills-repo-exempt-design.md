# Design: pre-commit hook 对 zenithjoy-skills 仓库例外放行

## 背景

`packages/engine/hooks/pre-commit` 通过 `~/.git-hooks`（`core.hooksPath`）对本机所有 git 仓库全局生效，强制要求：分支名匹配 `cp-MMDDHHNN-xxx` 且存在对应 `.dev-mode.<branch>` 文件才允许提交，否则一律拒绝（含 `git commit-tree` 之外的所有 porcelain 提交路径）。

`zenithjoy-skills` 是独立的 skill SSOT 仓库。按既有决策（memory: skills-architecture.md）"改 skill 走 skill-creator→PR，不走 /dev"，且 `branch-protect.sh` 已有同类先例注释"skills 已迁至 zenithjoy-skills repo，不再需要保护"。但 `pre-commit` hook 未跟进这次迁移，导致该仓库任何提交（包括通过 skill-creator 走的正规流程）都被误拦。今天实测：在该仓库删除25个未用skill时被迫用 `git commit-tree` 绕过 hook。

## 方案

在 `pre-commit` 脚本最前面（`PROJECT_ROOT` 确定之后、分支名判断之前）加一段仓库识别：

```bash
ORIGIN_URL=$(git -C "$PROJECT_ROOT" remote get-url origin 2>/dev/null || echo "")
if [[ "$ORIGIN_URL" == *"zenithjoy-skills"* ]]; then
    exit 0
fi
```

- 用 `remote get-url origin` 精确匹配仓库身份，不用路径/目录名（避免本地目录改名导致误判或误伤同名子目录）。
- 匹配到即直接 `exit 0`，不做任何分支名/`.dev-mode`检查——该仓库的提交纪律完全交给 skill-creator 自己的流程把关。
- 其他仓库（cecelia、zenithjoy-workspace 等）逻辑完全不变。

## 备选方案（未采用）

1. **按分支名模式豁免**（如允许 zenithjoy-skills 仓库任意分支名跳过 `.dev-mode` 检查）——被否决：仍然区分不了"这是不是 zenithjoy-skills 仓库"，本质没解决问题。
2. **在 zenithjoy-skills 仓库本地设置 `core.hooksPath` 覆盖全局配置**——被否决：这是每个 clone 各自配置，容易被新 clone/CI runner 漏配，不如在共享的 hook 脚本里做一次性判断可靠。

## 测试策略

`tests/hooks/test-pre-commit.sh` 已有4个场景（main拒绝/cp-*无dev-mode拒绝/cp-*有dev-mode放行/feature-*拒绝），本次新增第5个场景：临时 repo 设置 `origin` 为含 `zenithjoy-skills` 的 URL，在 `main` 分支直接提交应放行（对照组：`origin` 不含该字符串时，同样在 `main` 分支应仍被拒绝，确认没有误伤）。

该测试文件目前未接入 CI workflow，本次改动不新增接入（超出本次改动范围，若需要另开 issue）。

## 影响范围

仅影响 `zenithjoy-skills` 仓库的提交行为。不改变任何其他仓库、不改变 DevGate 三脚本（facts-check.mjs / check-version-sync.sh / check-dod-mapping.cjs）的行为。
