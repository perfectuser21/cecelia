// 共享永久回归：launcher → Brain HTTP 路由 → 真 PostgreSQL → GET 读回。
// 本地 psql 代理属于已退役的 launcher 写库路径，不再作为合同接口。
import '../../../packages/brain/src/__tests__/integration/session-provenance.integration.test.js';
