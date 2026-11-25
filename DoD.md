# Brain 按需发布验收

Task: 4fe1b714-3d51-4412-93d8-015177d9841d
GP-Anchor: none(infra)

- [ ] 真实 Git 树累计核对，稳定原生收据支持无需发布；未知或异常保守回原链，身份不伪造。
  Test: manual:node --test scripts/ci/__tests__/basic-brain-deploy-preflight.test.mjs
  Test: manual:node --test scripts/ci/__tests__/basic-brain-deploy-certification.test.mjs
- [ ] 实际 CI shell 路由对独立监控改动无 POST，对有效变更保留原 exact-SHA 发布与失败结果。
  Test: manual:node --test scripts/ci/__tests__/basic-brain-deploy-routing.test.mjs
- [ ] Scripts/Ops 完整回归通过，Brain 源码未改，保留唯一发布 job。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
  Test: manual:node scripts/ci/run-basic-check.mjs ops
  Test: manual:node --input-type=module -e "import {execFileSync} from 'node:child_process'; execFileSync('git',['diff','--exit-code','9dcb3692b6cebd11193fc6c872aa0470b2dfa142','--','packages/brain/src','packages/brain/package.json'],{stdio:'inherit'})"
