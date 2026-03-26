# Learning: fix(gtd): full-tree 过滤 archived objectives

## 背景

GTD OKR 页面每个 Area 下出现冗余的 objective 行，原因是 full-tree.js 的 objectives 查询没有过滤 `status = 'archived'` 的记录。

## 改动

`apps/api/src/task-system/full-tree.js` objectives 查询加 `AND o.status != 'archived'`：

```sql
WHERE o.area_id = ANY($1) AND o.status != 'archived'
```

### 根本原因

数据修复（将 7 条重复 sub-objective 标记为 archived）后，代码层没有对应过滤条件，导致已归档记录仍出现在树中。

问题核心：数据库层面的 status 状态修复与 API 查询层面的过滤条件是两个独立步骤，只做了数据修复而遗漏了查询过滤。

结果：GTD OKR 页面每个 Area 下显示冗余的重复 objective 行，树结构不干净。

### 下次预防

- [ ] 凡做数据 status 修复，同步检查 API 查询是否有对应过滤条件
- [ ] full-tree 类接口应在 WHERE 条件中明确排除 archived/deleted 状态
- [ ] DoD 测试优先用 `node -e "require('fs').readFileSync(...)"` 验证文件内容，避免 grep 进 CI 白名单问题
