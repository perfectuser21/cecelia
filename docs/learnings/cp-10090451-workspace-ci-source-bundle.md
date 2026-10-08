## Workspace跨仓CI固定来源（2026-10-09）

### 根本原因
单repo固定SHA提取器不能把Workspace caller和Brain callee当作同一来源，永久协议测试实际读YAML也不等于中央已有消费者归属。

### 下次预防
- [x] 对每份来源保repo/revision/hash，用实际Git对象正负测试拒绝main别名、uses与tooling_revision错配、固定源码缺失、二次读回漂移。约束：scripts/ci/__tests__/workspace-ci-source-bundle.test.mjs。
- [x] AST核真实import绑定、相对URL、YAML.parse/readFileSync及被node:test调用的helper，字符串和死分支不能认领。约束：scripts/ci/__tests__/workspace-ci-source-bundle.test.mjs。
- [x] 固定既有F3七字段，冻结required caller-job、callee interface/tooling checkout与node源码；bundle仅consumer_evidence且executable=false，来源未证全四refs未知。约束：scripts/ci/__tests__/workspace-ci-source-bundle.test.mjs。

事实：51项本地回归通过；固定Workspace de3/Brain8916源码只读提取9bindings/9relations来源verified，不等于运行成功或中央登记。

- [x] 解析真身位于 packages/brain/src/lib/workspace-ci-source-bundle.js，CI旧路径薄re-export；只依赖acorn/js-yaml，隔离目录排除eslint/espree真实导入，同一函数身份保证不复制解析器。生产依赖需C正式发布后才可上服务器，当前不冒称已部署。
- [x] 新可选admission_scopes仅接受既有6输入加精确schema-v1字段；新双分支callee只按完整已审核字节hash与MODE/scopes环境确认，普通死shell仍拒。静态来源verified与trusted_main_history准入分离，中央准入仍unknown。
