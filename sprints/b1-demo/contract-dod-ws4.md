# Contract DoD — Workstream 4: selfcheck.sh

**范围**: 产出 `sprints/b1-demo/selfcheck.sh`，自检脚本，依次校验前 3 个产物，齐全合规返回 0，缺/损返回非 0
**大小**: S（< 60 行）
**依赖**: ws1+ws2+ws3 完成后才能完整跑通（执行顺序 ws3→ws4）

## ARTIFACT 条目

- [ ] [ARTIFACT] 文件 `sprints/b1-demo/selfcheck.sh` 存在
  Test: node -e "require('fs').accessSync('sprints/b1-demo/selfcheck.sh')"

- [ ] [ARTIFACT] selfcheck.sh 首行含 bash shebang
  Test: node -e "const c=require('fs').readFileSync('sprints/b1-demo/selfcheck.sh','utf8');if(!/^#!\/(usr\/bin\/env\s+bash|bin\/bash)\b/.test(c.split('\n')[0]))process.exit(1)"

- [ ] [ARTIFACT] selfcheck.sh 文件体内含 `b1-demo` 字面量（针对本模块）
  Test: node -e "const c=require('fs').readFileSync('sprints/b1-demo/selfcheck.sh','utf8');if(!c.includes('b1-demo'))process.exit(1)"

- [ ] [ARTIFACT] selfcheck.sh 引用了 schema.md / config.json / query.md 三件产物路径
  Test: node -e "const c=require('fs').readFileSync('sprints/b1-demo/selfcheck.sh','utf8');for(const f of ['schema.md','config.json','query.md'])if(!c.includes(f))process.exit(1)"

- [ ] [ARTIFACT] selfcheck.sh 含 cwd 切换（`cd "$(dirname "$0")"` 或等价语义），保证脚本可在任意目录被 bash 调用
  Test: node -e "const c=require('fs').readFileSync('sprints/b1-demo/selfcheck.sh','utf8');if(!/cd\s+[\"']?\$\(.*dirname.*\$0.*\)[\"']?/.test(c))process.exit(1)"

- [ ] [ARTIFACT] selfcheck.sh 文件总行数 ≥ 15（非空 stub 防伪）
  Test: node -e "const c=require('fs').readFileSync('sprints/b1-demo/selfcheck.sh','utf8');if(c.split('\n').length<15)process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws4/）

见 `tests/ws4/selfcheck.test.ts`，覆盖：
- exits 0 when all four artifacts are present and valid
- exits non-zero when schema.md is missing
- exits non-zero when config.json is invalid JSON
- exits non-zero when query.md lacks b1-demo reference
