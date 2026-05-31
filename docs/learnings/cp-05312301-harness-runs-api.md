### 根本原因

GET /api/brain/harness/runs 接口不存在，外部无法查询 initiative_runs 运行历史列表。

### 下次预防

- [ ] 新增 Brain 列表接口时，limit 参数必须做 1-100 范围校验，NaN/越界统一返回 400
- [ ] 路由文件测试使用 `vi.mock('../../db.js')` 隔离 DB，不依赖真实 PostgreSQL
