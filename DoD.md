# Watchdog 本机 Brain 目标验收

Task: 970a32c9-9ad9-4718-be3f-eb584030d271
GP-Anchor: none(infra)

- [ ] 真实 Watchdog 只访问 us-vps 本机 127.0.0.1 的健康端点，错误旧地址即使返回 healthy 也会被回归拦截。
  Test: manual:bash scripts/ops/__tests__/watchdog/retired-brief.test.sh
- [ ] 现役 Brain/HK 告警、每日存活报到、去重与旧晨报退役保障保留，完整 Ops/Scripts 通过。
  Test: manual:node scripts/ci/run-basic-check.mjs ops
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
- [ ] Brain 源码及机外哨兵与基线相同，没有新增工作流或定时器。
  Test: manual:node --input-type=module -e "import {execFileSync} from 'node:child_process'; execFileSync('git',['diff','--exit-code','acdcd8ea78faaecf91c4b8ee3696fd8cb5540c02','--','packages/brain/src','.github/workflows/heartbeat-sentinel.yml'],{stdio:'inherit'})"
