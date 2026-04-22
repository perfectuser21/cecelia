# Contract DoD — Workstream 4: E2E 冒烟脚本 + README

**范围**: 新建 `scripts/harness-dogfood/e2e.sh`（可执行 bash，**必须读 PORT 环境变量**，按顺序访问三端点并做字段级校验）+ `scripts/harness-dogfood/README.md`（启动 + E2E 说明）。不触达 time-api.js 或任何 `__tests__/` 文件。
**大小**: S（e2e.sh 约 40-60 行 + README 约 30 行）
**依赖**: Workstream 1 / 2 / 3（E2E 需三个端点全部在线）

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/harness-dogfood/e2e.sh` 文件存在
  Test: test -f scripts/harness-dogfood/e2e.sh

- [ ] [ARTIFACT] e2e.sh 具备可执行权限位
  Test: test -x scripts/harness-dogfood/e2e.sh

- [ ] [ARTIFACT] e2e.sh 使用 bash shebang
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/e2e.sh','utf8');if(!/^#!.*bash/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] e2e.sh 含 `set -e` 或 `set -euo pipefail`（失败即停，任一端点错直接 exit 非 0）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/e2e.sh','utf8');if(!/set\s+-[eu]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] e2e.sh 引用 `/iso` 路径
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/e2e.sh','utf8');if(!/\/iso\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] e2e.sh 引用 `/timezone` 路径
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/e2e.sh','utf8');if(!/\/timezone\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] e2e.sh 引用 `/unix` 路径
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/e2e.sh','utf8');if(!/\/unix\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] e2e.sh 必须读取 PORT 环境变量（匹配 `$PORT`、`${PORT}` 或 `${PORT:-}` 展开形态）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/e2e.sh','utf8');if(!/\$\{?PORT(?::-[^}]*)?\}?/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `scripts/harness-dogfood/README.md` 文件存在
  Test: test -f scripts/harness-dogfood/README.md

- [ ] [ARTIFACT] README 含启动命令 `node scripts/harness-dogfood/time-api.js`
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/README.md','utf8');if(!/node\s+scripts\/harness-dogfood\/time-api\.js/.test(c))process.exit(1)"

- [ ] [ARTIFACT] README 含 E2E 冒烟脚本调用说明（引用 `scripts/harness-dogfood/e2e.sh`）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/README.md','utf8');if(!/scripts\/harness-dogfood\/e2e\.sh/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws4/）

见 `sprints/tests/ws4/e2e.test.ts`，共 7 个 it，覆盖：
- e2e.sh 文件存在
- e2e.sh 具备可执行权限位
- 服务已启动 + PORT 环境变量指向运行端口时，e2e.sh exit 0
- 端口空闲（没有服务）时，e2e.sh 以非 0 exit 退出（动态空闲端口，非硬编码）
- README.md 文件存在
- README 含启动命令 node scripts/harness-dogfood/time-api.js
- README 含 E2E 冒烟脚本调用说明
