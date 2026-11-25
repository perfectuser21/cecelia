# Watchdog 旧晨报探针退役验收

Task: 3a46d936-d100-426e-b46f-8baaa53fea68
GP-Anchor: none(infra)

- [ ] 固定工作日 UTC 01:25，真实脚本不调用旧 OpenClaw 容器或发送晨报假警；Brain/HK 检查和每日存活报到仍有效。
  Test: manual:bash scripts/ops/__tests__/watchdog/retired-brief.test.sh
- [ ] 新回归被当前 Ops 自动收集，完整 Ops 与 Scripts 组件通过。
  Test: manual:node scripts/ci/run-basic-check.mjs ops
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
- [ ] Brain 源码与基线相同，未扩大到派发、Notion、备份或运行服务改动。
  Test: manual:node --input-type=module -e "import {execFileSync} from 'node:child_process'; execFileSync('git',['diff','--exit-code','3532a553e8242be019658498c59b9255d54946ea','--','packages/brain/src'],{stdio:'inherit'})"
