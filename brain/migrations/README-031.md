# Migration 031 - Capabilities Embeddings

## 概述

Migration 031 为 `capabilities` 表添加了 vector embedding 支持，用于语义相似度搜索。

## 已完成

✅ **Migration 031 已成功应用**
- 添加了 `embedding vector(1536)` 列
- 创建了 HNSW 索引用于快速余弦相似度搜索
- Schema version 更新为 031

## 待完成

⏳ **生成 Embeddings**

由于 OpenAI API 配额限制，embeddings 尚未生成。在配额恢复后，运行以下命令：

```bash
# 方式 1: 本地运行（开发模式）
export $(cat ~/.credentials/openai.env | xargs)
cd brain
node src/generate-capability-embeddings.mjs

# 方式 2: Docker 容器运行（生产模式）
docker exec cecelia-node-brain sh -c "export \$(cat ~/.credentials/openai.env | xargs) && node src/generate-capability-embeddings.mjs"
```

## 验证

生成完成后，运行以下命令验证：

```sql
-- 查看有多少 capabilities 已有 embedding
SELECT COUNT(*) FROM capabilities WHERE embedding IS NOT NULL;
-- 应该返回 23

-- 测试语义搜索（示例）
SELECT
  id,
  name,
  1 - (embedding <=> '[0.1, 0.2, ...]'::vector) as similarity
FROM capabilities
WHERE embedding IS NOT NULL
ORDER BY embedding <=> '[0.1, 0.2, ...]'::vector
LIMIT 5;
```

## 技术细节

- **模型**: OpenAI `text-embedding-3-small`
- **维度**: 1536
- **索引**: HNSW (m=16, ef_construction=64)
- **距离度量**: Cosine similarity
- **Embedding 内容**: capability.name + capability.description

## 文件位置

- Migration: `/home/xx/perfect21/cecelia/core/brain/migrations/031_capabilities_embeddings.sql`
- 生成脚本: `/home/xx/perfect21/cecelia/core/brain/src/generate-capability-embeddings.mjs`
- OpenAI Client: `/home/xx/perfect21/cecelia/core/brain/src/openai-client.js`

## OpenAI 配额问题

当前遇到的错误：
```
429 You exceeded your current quota, please check your plan and billing details.
```

**解决方案**:
1. 检查 OpenAI 账户配额: https://platform.openai.com/account/usage
2. 等待配额重置或充值
3. 重新运行生成脚本

## 相关 PR

- Migration 028: 添加了 pgvector 扩展基础支持
- Migration 030: 创建了 capabilities 表和 23 个种子数据
- Migration 031: 添加了 embedding 列和索引（本次）
