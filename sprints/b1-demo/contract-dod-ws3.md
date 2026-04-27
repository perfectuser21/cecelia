# Contract DoD — Workstream 3: query.md

**范围**: 产出 `sprints/b1-demo/query.md`，对外查询入口契约（含 bash 示例 + Expected Output 章节）
**大小**: S（< 30 行）
**依赖**: 概念上引用 ws1 module 名（执行顺序 ws2→ws3，无运行期硬依赖）

## ARTIFACT 条目

- [ ] [ARTIFACT] 文件 `sprints/b1-demo/query.md` 存在
  Test: node -e "require('fs').accessSync('sprints/b1-demo/query.md')"

- [ ] [ARTIFACT] query.md 含至少一个 ```bash 围栏代码块
  Test: node -e "const c=require('fs').readFileSync('sprints/b1-demo/query.md','utf8');if(!/```bash\s*\n[\s\S]*?\n```/.test(c))process.exit(1)"

- [ ] [ARTIFACT] query.md 含二级标题 `## Query`
  Test: node -e "const c=require('fs').readFileSync('sprints/b1-demo/query.md','utf8');if(!/^##\s+Query\s*$/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] query.md 含二级标题 `## Expected Output`
  Test: node -e "const c=require('fs').readFileSync('sprints/b1-demo/query.md','utf8');if(!/^##\s+Expected Output\s*$/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] query.md 文件总行数 ≥ 10（非空 stub 防伪）
  Test: node -e "const c=require('fs').readFileSync('sprints/b1-demo/query.md','utf8');if(c.split('\n').length<10)process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws3/）

见 `tests/ws3/query.test.ts`，覆盖：
- contains at least one bash code block
- references b1-demo inside a bash example
- declares ## Query and ## Expected Output sections
- provides non-empty Expected Output sample
