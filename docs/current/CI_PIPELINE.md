---
id: current-ci-pipeline
version: 3.1.0
updated: 2026-11-25
authority: CURRENT_STATE
---

# Cecelia CI

实际命令以 `.github/workflows/`、`scripts/ci/run-basic-check.mjs` 为准。以下区分源码验收、隔离运行与生产监控；源码绿色不能证明生产业务执行成功。

## PR 与 main

只有 `ci.yml` 承担 PR 合并前 CI。PR与main push固定执行现役核心组件，不再根据修改路径减少源码或Ops检查。

现有3份工作流：主CI、夜间深度回归、健康哨兵。CI红灯告警、PR Preview部署/回收及旧独立发布模板已清退。Workflow登记、真实PG执行与故障恢复继续在主CI的 `runtime-integration` 中验收。

`ci.yml`现有8个job定义，矩阵展开最多20项：常规PR执行18项，main通过后再执行Brain生产发布；Foundation正式发布验证只在main按需触发，不是每次PR检查。

| job | 实际责任 |
|---|---|
| security | 凭据扫描、运行依赖high及全部依赖critical漏洞审计 |
| checks | Brain六分片、18个明确PG入口与源码运行、镜像构建、共享前端、Ops及scripts；Scripts矩阵入口检查固定BASE/HEAD版本递增 |
| runtime-integration | 机器接入、Linux授权的真实PG合同，以及公共Runner/Commander进程故障恢复；纯mock隔离回归仅在普通单测执行 |
| pwa-upgrade | Chromium验证PWA升级、交办回执、指挥舱收件箱和去向路由；业务API为隔离fixture |
| codeql | Actions、JS/TS、Python三个语言安全分析；另有每周扫描 |
| foundation-release-verification | main按需执行已登记发布回归，依赖本次源码检查通过 |
| brain-deploy | main源码检查通过后，以固定SHA/镜像执行隔离验收、生产切换及结算读回 |
| ci-passed | 汇总security/checks/runtime/browser/codeql五个父任务，所有被选矩阵必须成功 |

唯一汇总名为 `源码保底通过`。合并保护以GitHub当前分支保护及规则集为准；2026-11-12实读该项绑定GitHub Actions App 15368，strict=true。按需Foundation验证不作为这五项之一；生产发布依赖该汇总成功。

独立Linux资源Canary及其计划/汇总协议已清退；生产采样器与资源失败分类保留。按最近PR的同等组件范围，此后移除Plan准备runner，常规全量条目再减少1个；组件测试数量与此不同。

## 实际组件边界

- Brain普通单测、PG、源码HTTP生命周期和Docker构建是不同证据；PR镜像只build，不代表已启动生产服务。
- `apps/api`只保留Dashboard共享features和captures schema验证，不再有独立旧Core服务、Conductor、旧任务/OKR路由或后端编译入口。
- 共享features与Dashboard在一个组件任务中依次使用各自React/Vitest环境，再构建Dashboard，不能混用React18/19测试环境。
- Ops按已审查的现役类别发现入口。无生产上游的旧spawn/host/Docker执行器及专属测试、无调用的汇总脚本均已清退；现役fleet执行器保留。
- scripts检查CI本身的真实选择/退出/权限边界、开发工具、事实与版本一致、迁移编号及Skill所有权。默认按目录发现现役Node入口；无人使用的Skill复合动作身份自检与旧n8n能力映射生成器已清退，Skill真身所有权及现役构建源恢复保留；W19冻结、旧准入发布器和一次性历史授权回放已退出。两个仍被可选API消费的窄合同由 `node scripts/ci/run-legacy-checks.mjs` 显式执行。
- 独立MCP不进入现役核心矩阵或夜间PG回归；单测保留显式 `node scripts/ci/run-basic-check.mjs mcp`，PG合同保留显式 `npm run test:pg -w packages/mcp-readonly`，需专用测试库。
- 外置Skill正文、固定版本与关键词专属合同已退出本仓PR验收；普通单测不依赖本机私有正文。通用恢复器及Python所有权检查仍保留。
- 本地quickcheck只做准备：Brain lint、共享前端的Dashboard构建；CI或根依赖变更另跑scripts。真实命令失败必须阻止push。

原466份shell烟测已逐项审读，累计清退198份。最新一轮对93份待审项追溯建立目的、现役业务入口和断言效果：86份旧壳清退，必要边界迁入实际函数/路由、受控CLI与私有PG测试；7份保留（合同版本、invariants读回、部署节点profile、fleet回执schema、DBOS模块启动、内部模块健康账本、专属控制器权限）。现存268份；本轮93份均有明确处置，不再作为未核实项挂起。另清退两份无现役调用且硬读退役脚本的历史E2E副本。脚本文件数不是PR job数。现役模块、真实函数/HTTP/PG回归及部署扫描器保留。安全fixture会在执行前拒绝缺失的被测入口，避免把shell未执行造成的无副作用误判为安全验证通过。 当前18项PG选择由固定完整来源封组及静态输入闭包共同证明；添加新定义不会放宽对缺失、篡改或新旧控制字节混配的拒绝。

`fleet-worker-workspace` 与 `kernel-runtime-resource` 的实际验证保留，移除其已删除旧suite委托；受控shell回归核对完整现役suite集合和失败退出码，不点火真实Docker/PG。

## 深度回归与监控

| workflow | 触发 | 实际用途 |
|---|---|---|
| nightly-regression.yml | 每天北京时间03:00及按需 | 私有PG与完整数据库回归、captures schema、隔离launcher；另启动Brain镜像连接本人专用PG，运行Map Manifest正例 |
| heartbeat-sentinel.yml | 每30分钟及按需 | 从GitHub反向探测生产health，并确认main深度回归26小时内有成功回执；异常告警、恢复收口 |

夜间完整数据库回归为Commander审计另建同一CI服务拥有的 `cecelia_scratch` 并显式传入 `TEST_DB_URL`；其余回归保持原 `cecelia_test`。Commander文件此前在此入口会仅跑3项本地检查并跳过9项PG用例；修复后已在独占空scratch实测12项全部执行，生产库不参与。


默认深度回归不发现三个人工长驻浏览器预览服务；原显式环境开关保留。两条旧Bridge真实Codex资格用例只在明确开关开启时登记，普通PG合同继续执行；现役Workflow登记和原生任务链保留。旧无调用radius私有适配与专属测试清退，当前graph/radius及联动报告不受影响。

`workflow-common-terminal.pg.integration.test.js`汇总并静态导入六份终态保障，PR固定入口继续使用该汇总；夜间只从汇总登记这些叶子，避免相同断言再由glob重复执行。自动覆盖盘点识别实际静态测试导入，不把被汇总执行的叶子算作未运行债务。

深度回归的 `real-env-smoke` 使用GitHub隔离容器与专用PG，不是手机真机或生产账号验收。通用CI不占用手机、社媒账号或线上业务资源。

## 使用边界

数据库测试只连接本轮拥有的本机scratch或CI服务，拒绝默认生产连接。正式CD由主CI的 `brain-deploy` 执行：固定Git构建、同镜像导入校验、只读完整生产快照恢复到独立库、隔离迁移和任务/产物/进程停止验收，再排空旧Brain、切换、核验在线SHA与官方只读业务回执并结算。候选环境关闭对外调度；其收据不代表真实外部模型或全部业务已覆盖。Implementation impact、Learning月归档及合并文档清理不在当前自动CI/CD中。

当前来源与执行资格需要固定Git、真实输入、owner和权限边界；历史工作流曾经绿色不能为新候选授予资格。退役历史接受矩阵不应通过宽松解析或默认成功替代。

```bash
npm ci --ignore-scripts
node scripts/ci/run-basic-check.mjs scripts
node scripts/ci/run-basic-check.mjs dashboard
node scripts/ci/run-basic-check.mjs brain-unit 1
```
