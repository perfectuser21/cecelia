---
branch: cp-03192117-fix-executor-workflow
date: 2026-03-19
type: learning
---

## 修复 executor findings 搜索和文案模板（2026-03-19）

### 根本原因
1. generate executor 的 findings 搜索用 `find(d => d.includes(slug))` 会匹配到空目录
2. findings 结构有 capability/data 字段但没有 content 字段，模板用 f.content 取到空字符串

### 修复方案
1. findings 搜索改为遍历所有候选目录，取 findings 数量最多的
2. 文案模板改用 `f.content || f.capability`，数据用 `f.data`

### 下次预防
- [ ] findings JSON schema 应该在 YAML 配置里定义，executor 按 schema 读取
- [ ] 新建 research 目录时不要创建空 findings，应该跳过或标记 status=empty
- [ ] generate 应该在 findings=0 时直接 fail，不要生成空壳文案
