# Learning: 重构 preparePrompt（复杂度 107 → 10）

## 根本原因
`preparePrompt` 函数将 20+ 种任务类型的路由逻辑全部内联，累积圈复杂度达到 107。主要来源：
1. 每种 `taskType` 一个 `if-else` 分支（~20 个）
2. decomposition 子分支中有 3 层嵌套
3. 每个分支内部有多个 `||` 默认值表达式

## 解决方案
1. 按功能域提取 16 个命名子函数（`_build*Prompt`）
2. 主函数改为 dispatch table（对象字典查找），消除 if-else 链
3. 将变量初始化中的 `task.payload?.xxx` 可选链替换为 `const payload = task.payload || {}; payload.xxx`，消除 Brain 复杂度扫描器的误计（scanner 使用 `/\?[^:]+:/g` 匹配三元运算符，会将 `?.prop:nextKey:` 误算为三元）

## 下次预防
- [ ] 路由型函数应优先使用 dispatch table（对象字典），而非 if-else 链
- [ ] Brain 复杂度扫描器对 `?.` 可选链有误计，提取子函数时应用 `const payload = task.payload || {}` 消除 `?.` 调用
- [ ] 新增任务类型时直接在 `typeHandlers` 对象中加条目，不要新增 if 分支
