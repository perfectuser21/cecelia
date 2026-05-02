# Brain Test Pyramid PR2 — Memory Search Roundtrip Integration Test

## 根本原因

Memory 搜索 API 只有端点存活检查，缺少"存入内容→搜索→验证检索到"的闭环测试，
无法保证 Jaccard 相似度算法、score 过滤阈值（>0.3）、返回字段格式在系统变更后仍然正确。

## 下次预防

- [ ] Memory/Search 类 API 必须有闭环 integration test（store → search → verify），
      不能只验证端点存活（HTTP 200）
- [ ] 写 integration test 时先确认数据来源（本例 memory 读 tasks 表），
      再设计测试数据写入策略（直接 INSERT vs. 调 API）
- [ ] Jaccard fallback 需 mock OpenAI client 失败触发，测试数据 token 重叠要足够高（score > 0.3）
      关键细节：tokenize() 对中文是连续字符整体作为 token（不逐字拆分），中文 Jaccard score 极低；
      集成测试使用英文词汇确保 token 级别重叠，Jaccard score ≈ 0.7
- [ ] beforeAll 写数据 + afterAll 精确清理（按 ID DELETE，不按 pattern 批量删）
- [ ] tasks 表写入的测试数据 status 必须是 pending/in_progress/completed 之一，
      否则 Jaccard 搜索的 WHERE 子句会排除该数据
