# 显式MMV获客派发验收

- [x] [BEHAVIOR] mmvleadgenbinding 101/102只接受完整显式MMV登记路由与已核公司账号；双中央别名锁、失败清场、未知不重放保持；103复用原102 PG冻结授权；104仍M4，原实体serial及评分不变。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/leadgen-resources.test.js src/lib/__tests__/leadgen-dispatch-contract.test.js src/lib/__tests__/leadgen-dispatch.test.js src/lib/__tests__/leadgen-batch-proof.test.js src/lib/__tests__/leadgen-runtime-status.test.js src/lib/__tests__/leadgen-empty-terminal.test.js src/lib/leadgen-controller.test.js src/routes/phone-registry.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] mmvleadgenserial phone-registry原认证与参数化SQL接受严格IPv4:port，非法octet、port、域名与任意命令仍拒绝。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/routes/phone-registry.test.js --maxWorkers=1 --minWorkers=1"
