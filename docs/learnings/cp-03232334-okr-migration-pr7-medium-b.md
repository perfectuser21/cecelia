# Learning: OKR 业务代码迁移 PR7 — validate-okr-structure 测试 mock 同步

## 背景

PR7 将 validate-okr-structure.js 中的 `goals`/`projects` 表查询迁移到新 OKR 七层表
（visions/objectives/key_results/okr_projects/okr_scopes/okr_initiatives）。
但测试文件的 `makeMockPool` 仍使用旧表名做 SQL 匹配，导致 mock 无法拦截新 SQL，
返回空数组，造成 15 个测试失败。

## 根本原因

`makeMockPool` 通过检测 SQL 字符串中的 `from goals` / `from projects` 来路由 mock 数据。
迁移后新 SQL 使用 `FROM visions` / `FROM okr_projects`（UNION ALL 合并查询），
不再包含旧表名，导致 mock 匹配失败，所有 goals/projects 查询返回空数组。

## 修复方案

将 mock 匹配逻辑从旧表名更新为新表名：
- `from goals` → `from visions` / `from objectives` / `from key_results`（任意一个匹配即可）
- `from projects` → `from okr_projects` / `from okr_scopes` / `from okr_initiatives`（任意一个匹配即可）

## 下次预防

- [ ] 迁移业务代码（SQL 查询）时，必须同步检查所有测试文件中的 mock SQL 匹配逻辑
- [ ] `makeMockPool` 等 mock 函数如果通过字符串匹配 SQL，迁移后必须更新匹配条件
- [ ] 迁移 PR 的 DoD 应包含"测试 mock 已同步到新表名"的验收条件
