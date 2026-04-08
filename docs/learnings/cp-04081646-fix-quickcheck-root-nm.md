# Learning: quickcheck.sh — monorepo workspace hoisting

## 根本原因

npm workspaces monorepo 把所有工具二进制提升（hoist）到根目录 `node_modules/.bin/`。包级 `node_modules/` 目录存在但为空（或只有极少数私有包）。PR #2025 用 `[[ -d "$ENGINE_NM" ]]` 检查时返回 true（空目录存在），假阳性导致进入测试分支，但 `$ENGINE_NM/.bin/vitest` 不存在，PATH 注入无效，测试仍然找不到 vitest。

## 修复

用单一变量 `ROOT_NM="$MAIN_REPO_ROOT/node_modules"` 替代所有包级 node_modules 路径。
存在性检查改为 `[[ -x "$ROOT_NM/.bin/vitest" ]]`（检查二进制是否可执行，而不是目录是否存在）。

## 下次预防

- [ ] 写脚本检查依赖时，monorepo 里要查根目录 `node_modules/.bin/`，不要查包级目录
- [ ] 存在性检查用 `-x binary` 而不是 `-d directory`，后者在空目录时假阳性
- [ ] 任何 PATH 注入，先验证 `.bin/tool` 是否真的可执行再注入
