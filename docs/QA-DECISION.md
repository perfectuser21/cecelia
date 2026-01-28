# QA Decision

Decision: NO_RCI
Priority: P1
RepoType: Business

## Tests

| DoD Item | Method | Location |
|----------|--------|----------|
| 能索引 /home/xx/dev 下所有 .md 文件 | auto | tests/test_indexer.py |
| 查询 "autopilot" 能返回相关文档片段 | auto | tests/test_search.py |
| 响应时间 < 100ms（本地查询） | auto | tests/test_performance.py |
| CLI index 命令正常工作 | auto | tests/test_cli.py |
| CLI search 命令正常工作 | auto | tests/test_cli.py |
| API /health 返回正确状态 | auto | tests/test_api.py |
| API /fusion 返回搜索结果 | auto | tests/test_api.py |
| Docker 构建成功 | manual | manual:docker build 验证 |

## RCI

- new: []
- update: []

## Reason

MVP 阶段，新仓库无现有回归契约。功能稳定后再考虑建立 RCI。当前优先保证单元测试覆盖核心功能：Chunker、Embedder、Store、API。
