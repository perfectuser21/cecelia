# QA Decision: Protective Brain Runtime

**Decision**: NO_RCI
**Priority**: P0
**RepoType**: Engine

## Tests

| DoD Item | Method | Location |
|----------|--------|----------|
| migrate.js 幂等执行迁移 | manual | manual:node src/migrate.js 两次，第二次全 SKIP |
| selfcheck 6 项 PASS | manual | manual:ENV_REGION=us node src/selfcheck.js |
| selfcheck 单元测试 10/10 | auto | brain/src/__tests__/selfcheck.test.js |
| Dockerfile 构建成功 | manual | manual:docker build -t cecelia-brain:test ./brain |
| 非 root 用户 | manual | manual:docker run --rm cecelia-brain:test whoami → cecelia |
| prod compose read_only | manual | manual:docker exec touch /app/x → fail |
| brain-deploy.sh 完整流程 | manual | manual:bash scripts/brain-deploy.sh |
| brain-rollback.sh 回滚 | manual | manual:bash scripts/brain-rollback.sh |
| 不引入新测试失败 | auto | npx vitest run |

## RCI

**new**: []
**update**: []

## Reason

基础设施变更（迁移系统、自检、Docker 镜像、部署脚本），不涉及业务逻辑。selfcheck 有完整的 mock 单元测试覆盖。其余通过手动验证部署流程。

## Scope

**允许修改的范围**:
- `brain/src/migrate.js` - 新增迁移运行器
- `brain/src/selfcheck.js` - 新增启动自检
- `brain/src/__tests__/selfcheck.test.js` - 新增自检测试
- `brain/migrations/005_*.sql` - 新增迁移
- `brain/Dockerfile` - 新增生产镜像
- `brain/.dockerignore` - 新增构建排除
- `brain/server.js` - 添加 migrate + selfcheck 调用
- `brain/package.json` - 版本升级
- `docker-compose.yml` - 添加 ENV_REGION
- `docker-compose.prod.yml` - 新增生产 compose
- `scripts/brain-*.sh` - 新增部署脚本
- `.env.example`, `.env.docker`, `.gitignore` - 配置更新
