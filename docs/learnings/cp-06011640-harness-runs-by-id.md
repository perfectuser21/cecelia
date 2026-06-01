### 根本原因

GET /api/brain/harness/runs/:id 接口缺失，无法按 run 自身 UUID 精确查询单条 initiative_run 记录。

### 下次预防

- [ ] 新增 Brain 查询端点时，UUID 校验统一复用文件顶部 `UUID_RE` 常量
- [ ] 精确查询（/:id）返回 404 时 error 字符串必须明确（'harness run not found'），便于调用方区分 400/404
