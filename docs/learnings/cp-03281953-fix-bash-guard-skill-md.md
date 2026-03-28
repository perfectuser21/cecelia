# Learning: 移除 bash-guard 过时的 SKILL.md symlink 拦截规则

Branch: cp-03281953-fix-bash-guard-skill-md
Date: 2026-03-28

## 背景

`~/.claude/skills/` 下的 26 个 skills 已从 symlink 转为独立真实目录（不再属于 git 追踪范围），但 bash-guard.sh 的"规则 4"仍基于旧 symlink 假设运行，导致对独立 skill 目录的任何 bash 操作（包括读取）都被误拦截。

### 根本原因

bash-guard 使用字符串模式匹配（`SKILL_PATH_PATTERN`）拦截包含 `.claude/skills/*/SKILL.md` 路径的所有 bash 命令，但未区分"路径指向 git 仓库内文件"和"路径指向独立目录文件"。当 symlink 结构改变后，该规则变为过时保护，产生大量误拦截。

### 下次预防

- [ ] 当系统架构（目录结构/symlink关系）发生变化时，同步审查所有依赖该结构的 hook 规则
- [ ] hook 规则应描述"要保护的行为"而非"路径字符串模式"，减少对路径结构的硬依赖
- [ ] `branch-protect.sh` 已有更精确的 Engine skill 保护逻辑，bash-guard 不应重复承担同一职责（单一职责）
