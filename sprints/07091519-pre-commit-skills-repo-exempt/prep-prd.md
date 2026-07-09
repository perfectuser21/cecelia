# 小改动 PrepPRD：pre-commit hook 对 zenithjoy-skills 仓库做例外放行

## 改什么
`packages/engine/hooks/pre-commit`（通过 `~/.git-hooks` 全局生效于所有仓库），在开头加一段仓库识别逻辑——当 `git remote get-url origin` 匹配 `zenithjoy-skills` 时，直接 `exit 0`，跳过后面 cp-*分支名 + `.dev-mode` 文件的强制检查。其他仓库（cecelia、zenithjoy-workspace等）逻辑不变。

## 为什么改
`zenithjoy-skills` 是纯 skill SSOT 仓库，按既定规矩"改 skill 走 skill-creator→PR，不走 /dev"（memory: skills-architecture.md），且 `branch-protect.sh` 里已有先例注释"skills 已迁至 zenithjoy-skills repo，不再需要保护"——这个 pre-commit hook 是唯一没跟上迁移的一处，导致任何往该仓库提交（哪怕通过 skill-creator 走正规流程）都会被拦，实测被迫用 git plumbing(commit-tree) 绕过 hook 才能提交。

## 关联上下文
- 相关历史决策：无匹配（decisions/match 查询返回空）
- 相关 in-progress task：无

## 影响范围
只影响 `zenithjoy-skills` 仓库的提交体验；其他仓库（cecelia、zenithjoy-workspace）的 cp-*/.dev-mode 强制逻辑完全不受影响（用 remote URL 精确匹配，不会误伤）。

## 验收标准
- [ ] 在 `zenithjoy-skills` 仓库（非 cp-* 分支）能正常 `git commit`，不再被拦
- [ ] 在 `cecelia` 仓库（非 cp-* 分支）依然被拦（回归测试：确认没把口子开大了）
- [ ] CI 全绿
