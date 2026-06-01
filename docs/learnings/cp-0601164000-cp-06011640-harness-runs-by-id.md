## GET /api/brain/harness/runs/:id（2026-06-01）

### 根本原因

缺少按 run 自身 UUID 精确查询的接口，只有列表接口（/runs）和按 initiative_id 查的接口（/initiative-runs/:id），导致调用方无法通过 run ID 获取单条记录。

### 下次预防

- [ ] 新增列表接口时同步评估是否需要配套精确查询接口（/:id）
- [ ] UUID 校验统一复用文件顶部 UUID_RE 常量
- [ ] 精确查询 404 时 error 字符串需明确（'harness run not found'），便于调用方区分
