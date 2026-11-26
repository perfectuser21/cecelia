# 自动发布拒绝旧提交覆盖已上线后继版本

Task: f598d05b-cfb9-4e40-8f32-a2fbe7f77a29
GP-Anchor: none(infra)

- [x] 自动与直接发布在真实共享锁内、任何reset/build/migrate/swap前核验目标main成员与现役祖先关系；旧、分叉、未知拒绝。
  Test: manual:node --test scripts/ci/__tests__/basic-deploy-ordering.test.mjs
- [x] 新远端main对象可先fetch再准入；未合并本地后代拒绝；已知身份但健康失败可正常向前修复。
  Test: manual:node --test scripts/ci/__tests__/basic-deploy-ordering.test.mjs
- [x] 父子FD继承重入不死锁且保持排他；显式回滚与原生成功收据保持。
  Test: manual:node --test scripts/ci/__tests__/basic-deploy-ordering.test.mjs scripts/brain-image-retention-ledger.test.mjs
- [x] 客户端明确拒绝时不POST，旧或未知顺序的waiter不能重触发；服务端独立准入为最终防线。
  Test: manual:node --test scripts/ci/__tests__/basic-brain-deploy-preflight.test.mjs scripts/ci/__tests__/basic-brain-deploy-routing.test.mjs
  Test: manual:bash scripts/ci/__tests__/gate3-wait-deploy.test.sh
- [x] 版本、事实、候选与原前驱恢复场景保留；新缺陷回归进入默认Scripts集合。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
