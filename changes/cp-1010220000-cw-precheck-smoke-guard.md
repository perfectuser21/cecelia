## Brain {VERSION} — coding harness：本地 CI 预检加 smoke 写入守卫

- 金丝雀 4（PR #6232）新增的写入型 smoke 没登记 smoke-write-targets、curl 没带 -q，到 CI Smoke Glob Runner 才红，触发 CI 修复。build 的 ci_precheck 清单里没有这条守卫。
- 预检加 smoke-write-guard：node --test packages/quality/tests/smoke-production-guard.node-test.mjs（离线可跑，同 Smoke Glob Runner 那条守卫），红了交预检修复会话。
- 预检「脚本不存在就跳过」改为认参数里的脚本文件（.sh/.js/.mjs/.cjs），node --test <文件> 也能正确跳过，bash -c 内联命令不受影响。
