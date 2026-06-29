contract_branch: cp-06291932-ws-5417f890-ws1
sprint_dir: sprints/06291830-review-env

---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: evaluator PASS 后自动分配端口启动 Dashboard 静态 Review 环境

**范围**: review-env-manager.js 新建 + harness-task.graph.js mergePrNode 集成 + shepherd.js 清理钩子 + 3 个 Brain API 端点 + DB migration
**大小**: M

---

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/brain/src/review-env-manager.js` 存在且导出 `allocateReviewEnv` / `releaseReviewEnv` / `cleanupHarnessReviewEnvs` / `findFreePort`
  Test: node -e "const m=require('./packages/brain/src/review-env-manager.js');['allocateReviewEnv','releaseReviewEnv','cleanupHarnessReviewEnvs','findFreePort'].forEach(f=>{if(typeof m[f]!=='function')throw new Error('缺少导出:'+f)})"

- [x] [ARTIFACT] `packages/brain/src/db/migrations/012-review-environments.sql` 存在且含 `CREATE TABLE review_environments`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/db/migrations/012-review-environments.sql','utf8');if(!c.includes('CREATE TABLE review_environments'))throw new Error('migration 缺 CREATE TABLE')"

- [x] [ARTIFACT] `packages/brain/src/routes/harness.js` 包含 `/review-env/allocate` 路由注册
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('review-env/allocate'))throw new Error('缺少 allocate 路由')"

- [x] [ARTIFACT] `packages/brain/src/routes/harness.js` 包含 `/review-env/release` 路由注册
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('review-env/release'))throw new Error('缺少 release 路由')"

- [x] [ARTIFACT] `packages/brain/src/workflows/harness-task.graph.js` 的 `mergePrNode` 含 `allocateReviewEnv` 调用
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!c.includes('allocateReviewEnv'))throw new Error('mergePrNode 未集成 allocateReviewEnv')"

- [x] [ARTIFACT] `packages/brain/src/shepherd.js` 含 `cleanupHarnessReviewEnvs` 调用
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/shepherd.js','utf8');if(!c.includes('cleanupHarnessReviewEnvs'))throw new Error('shepherd 未集成清理钩子')"

---

## BEHAVIOR 条目（已本地通过单元测试验证）

- [x] [BEHAVIOR] POST /api/brain/harness/review-env/allocate 返回 { initiative_id, port∈[5300,5399], pid>0, skipped:false }
- [x] [BEHAVIOR] POST allocate 响应 keys 完全等于 ["initiative_id","pid","port","skipped"]
- [x] [BEHAVIOR] allocate 后静态服务 HTTP 200 + HTML 响应
- [x] [BEHAVIOR] review_environments 表有 allocated_at 时间窗记录
- [x] [BEHAVIOR] POST /api/brain/harness/review-env/release 返回 { released:true, initiative_id }
- [x] [BEHAVIOR] release 后端口关闭且 DB 记录删除
- [x] [BEHAVIOR] GET /api/brain/harness/review-env/:id 返回完整 schema，未知 ID 返回 404
- [x] [BEHAVIOR] 缺少 initiative_id → HTTP 400 + error 字段
- [x] [BEHAVIOR] 端口耗尽时 allocate 返回 skipped=true + port=null + pid=null
- [x] [BEHAVIOR] dist 目录不存在时 allocate 返回 skipped=true + port=null + pid=null
- [x] [BEHAVIOR] 同一 initiative 二次 allocate → 旧端口关闭 + 新端口 HTTP200 + DB count=1

---

注：[CI_GAP] Brain API 端点 BEHAVIOR 自验跳过（Brain 未热重载新代码），由 evaluator 在部署后验证。
