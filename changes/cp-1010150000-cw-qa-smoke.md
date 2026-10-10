## Brain {VERSION} — coding harness：真人 QA 的验收命令固化成回归 smoke

- 审计 P2 #9（旧 controller 1.5.0「E2E 验收脚本必须有 CI 回归宿主」），主理人决策 c8621227：
  - QA 与独立裁判都通过后，把 PASS 的 T-n 里请求预览环境 API 的命令搬进 `packages/brain/scripts/smoke/cw-<task 前 8 位>-qa-smoke.sh`：
    - 预览地址换成 `$BRAIN_URL`，curl 统一 `-q`；
    - 开浏览器的条目不收；
    - 有写请求的加生产保护并登记 write-targets。
  - 登记 allowlist，CI 跑不过就挡合并。
  - 和 QA 报告、裁决放在同一个提交里，批准绑定这个 head，合并门不会撤销批准。
- spec prompt：每个 Q-n 的前提必须由场景自己造，能在空库复现。evaluate prompt：API 命令会被固化成回归，必须自己造数据、用会失败的断言，不能依赖预览库里已有的数据。
- 用仓库真实的 smoke 写入守卫（`smoke-production-guard.node-test`，87 条）验证过生成的脚本。
