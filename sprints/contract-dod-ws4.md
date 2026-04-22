# Contract DoD — Workstream 4: E2E 冒烟脚本 + README

**范围**: 新建 `scripts/harness-dogfood/e2e.sh`（可执行 bash，按顺序访问三端点并校验）+ `scripts/harness-dogfood/README.md`（启动 + E2E 说明）。
**大小**: S（e2e.sh 约 40 行 + README 约 30 行）
**依赖**: Workstream 1 / 2 / 3（E2E 需三个端点全部在线）

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/harness-dogfood/e2e.sh` 文件存在
  Test: test -f scripts/harness-dogfood/e2e.sh

- [ ] [ARTIFACT] e2e.sh 具备可执行权限位
  Test: test -x scripts/harness-dogfood/e2e.sh

- [ ] [ARTIFACT] e2e.sh 引用 `/iso` 路径
  Test: grep -c "/iso" scripts/harness-dogfood/e2e.sh

- [ ] [ARTIFACT] e2e.sh 引用 `/timezone` 路径
  Test: grep -c "/timezone" scripts/harness-dogfood/e2e.sh

- [ ] [ARTIFACT] e2e.sh 引用 `/unix` 路径
  Test: grep -c "/unix" scripts/harness-dogfood/e2e.sh

- [ ] [ARTIFACT] e2e.sh 使用 bash shebang 或 set -e
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/e2e.sh','utf8');if(!/^#!.*bash/m.test(c))process.exit(1);if(!/set\s+-e/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `scripts/harness-dogfood/README.md` 文件存在
  Test: test -f scripts/harness-dogfood/README.md

- [ ] [ARTIFACT] README 含启动命令 `node scripts/harness-dogfood/time-api.js`
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/README.md','utf8');if(!/node\s+scripts\/harness-dogfood\/time-api\.js/.test(c))process.exit(1)"

- [ ] [ARTIFACT] README 含 E2E 冒烟脚本调用说明
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/README.md','utf8');if(!/scripts\/harness-dogfood\/e2e\.sh/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws4/）

见 `sprints/tests/ws4/e2e.test.ts`，覆盖：
- 服务已启动时运行 e2e.sh 以 exit code 0 退出
- 服务未启动时运行 e2e.sh 以非 0 exit code 退出
