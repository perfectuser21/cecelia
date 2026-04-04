# Learning: 重构 executor.preparePrompt（CC 107 → 20 行）

## 根本原因

`preparePrompt` 积累了 17+ 种 taskType 分支，全部堆在一个函数里（431 行），圈复杂度达到 107。典型的"垃圾抽屉"反模式：每次加新 taskType 都往里塞 if/else。

## 解决方案

- 每种 taskType 提取为独立命名函数 `build<Type>Prompt(task)`
- 主函数通过 `TASK_TYPE_PROMPT_HANDLERS` dispatch map 路由
- 主函数仅 20 行，CC < 5

## 下次预防

- [ ] 新增 taskType 时直接添加子函数 + 在 dispatch map 注册，禁止在 `preparePrompt` 主体增加 if/else
- [ ] PR 中包含 `preparePrompt` 变更时，reviewer 检查是否新增了子函数而非直接改主体
- [ ] 定期运行复杂度扫描（已有 Brain 任务自动触发）
