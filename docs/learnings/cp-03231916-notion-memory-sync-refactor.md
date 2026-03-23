# Learning: 重构高复杂度函数（contactFieldsToNotionProps）

**Branch**: cp-03231916-eb2eaecb-08a1-4179-a5eb-a3865a
**Date**: 2026-03-23

## 任务描述

将 `notion-memory-sync.js` 中 `contactFieldsToNotionProps` 的圈复杂度从 27 降至 4，通过查找表模式替换 if-else 链。

### 根本原因

函数圈复杂度高（CC=27）源于三个叠加因素：
1. 9 个 if-else if 分支（CC +9）
2. 每个条件中的 `&&`/`||` 逻辑运算符（CC +9）
3. else 块内嵌套 4 个 if（CC +4）
以及基础复杂度 +1 = 总计 CC=24+（实测 27）

### 解决方案

- 用 `KNOWN_FIELD_HANDLERS` 查找表（数组 + match/build 函数对）替换 9 个 if-else 分支
- 提取 `applyKnownField()` 遍历查找表
- 提取 `applyAutoDetect()` 处理未知字段自动检测
- 主函数 CC 降至 4（for + 2 if + 1 if）

### 下次预防

- [ ] 新增字段映射逻辑时，优先添加到 `KNOWN_FIELD_HANDLERS` 数组，不要在函数体内新增 if-else
- [ ] 类似"多分支按类型路由"的模式，第一次写就用查找表，避免事后重构
- [ ] CC > 10 的函数在 PR 创建前即通过 `node` 脚本验证（DoD 中加入 CC 检查）
