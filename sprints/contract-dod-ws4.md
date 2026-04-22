# Contract DoD — Workstream 4: E2E 冒烟脚本 + README

**范围**: 新建 `scripts/harness-dogfood/e2e.sh`（可执行 bash，必须以**默认值展开形态**读取 PORT 环境变量，按顺序访问三端点并做字段级校验，全通过 exit 0，任一失败 exit 非 0）+ `scripts/harness-dogfood/README.md`（启动 + E2E 说明）。不触达任何 .js 文件。

**大小**: S（e2e.sh 约 40-60 行 + README 约 30 行）

**依赖**: Workstream 1 / 2 / 3（E2E 需三端点全在线）

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/harness-dogfood/e2e.sh` 文件存在
  Test: test -f scripts/harness-dogfood/e2e.sh

- [ ] [ARTIFACT] e2e.sh 具备可执行权限位
  Test: test -x scripts/harness-dogfood/e2e.sh

- [ ] [ARTIFACT] e2e.sh 使用 bash shebang
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/e2e.sh','utf8');if(!/^#!.*bash/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] e2e.sh 含 `set -e` 或 `set -eu` / `set -euo pipefail`（失败即停）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/e2e.sh','utf8');if(!/set\s+-[eu]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] e2e.sh 引用 `/iso` 路径
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/e2e.sh','utf8');if(!/\/iso\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] e2e.sh 引用 `/timezone` 路径
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/e2e.sh','utf8');if(!/\/timezone\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] e2e.sh 引用 `/unix` 路径
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/e2e.sh','utf8');if(!/\/unix\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] e2e.sh 含 PORT **默认值展开形态**（`${PORT:-...}` 或 `${PORT-...}` 或 `: ${PORT:=...}`；排除纯硬编码赋值）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/e2e.sh','utf8');if(!/(\$\{PORT:-|\$\{PORT-|:\s*\$\{PORT:=)/.test(c)){console.error('FAIL: e2e.sh 必须用 \${PORT:-} / \${PORT-} / : \${PORT:=} 三种默认值展开形态之一');process.exit(1)}"

- [ ] [ARTIFACT] e2e.sh **不含** 行首硬编码 `PORT=` 赋值（排除 `PORT=18080` 这类非展开赋值）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/e2e.sh','utf8');const lines=c.split(/\r?\n/);for(const line of lines){const stripped=line.replace(/^\s*/,'');if(/^PORT\s*=\s*['\x22]?[\w.-]+['\x22]?\s*(#.*)?$/.test(stripped)){console.error('FAIL: e2e.sh 含硬编码 PORT= 赋值行: '+line);process.exit(1)}}"

- [ ] [ARTIFACT] `scripts/harness-dogfood/README.md` 文件存在
  Test: test -f scripts/harness-dogfood/README.md

- [ ] [ARTIFACT] README 含启动命令 `node scripts/harness-dogfood/time-api.js`
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/README.md','utf8');if(!/node\s+scripts\/harness-dogfood\/time-api\.js/.test(c))process.exit(1)"

- [ ] [ARTIFACT] README 含 E2E 冒烟脚本调用说明（引用 `scripts/harness-dogfood/e2e.sh`）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/README.md','utf8');if(!/scripts\/harness-dogfood\/e2e\.sh/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws4/）

见 `sprints/tests/ws4/e2e.test.ts`，共 8 个 it，覆盖：
- e2e.sh 文件存在
- e2e.sh 具备可执行权限位
- 服务已启动 + PORT 环境变量指向运行端口时，e2e.sh exit 0
- 端口有 503 探针服务时，e2e.sh exit 非 0（无竞争窗口）
- e2e.sh 源码含 PORT 默认值展开形态（${PORT:-} 或等效，非硬编码赋值）
- README.md 文件存在
- README 含启动命令 node scripts/harness-dogfood/time-api.js
- README 含 E2E 冒烟脚本调用说明
