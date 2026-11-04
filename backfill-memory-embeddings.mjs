/** 历史一次性入口已退役；原实现由Git历史保留，不再提供默认生产连接或模型调用。 */
process.stderr.write('retired_memory_embedding_backfill: 历史回填入口已退役；需按现行数据修复流程核定目标与缺向量存量。\n');
process.exitCode = 1;
