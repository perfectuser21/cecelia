# Contract DoD — Workstream 2: config.json

**范围**: 产出 `sprints/b1-demo/config.json`，模块运行配置（合法 JSON，含 module/enabled/entrypoint/version）
**大小**: S（< 20 行）
**依赖**: 概念上引用 ws1 命名一致（执行顺序 ws1→ws2，无运行期硬依赖）

## ARTIFACT 条目

- [ ] [ARTIFACT] 文件 `sprints/b1-demo/config.json` 存在
  Test: node -e "require('fs').accessSync('sprints/b1-demo/config.json')"

- [ ] [ARTIFACT] config.json 含 `"module"` JSON key 字面量
  Test: node -e "const c=require('fs').readFileSync('sprints/b1-demo/config.json','utf8');if(!/\"module\"\s*:/.test(c))process.exit(1)"

- [ ] [ARTIFACT] config.json 含 `"enabled"` JSON key 字面量
  Test: node -e "const c=require('fs').readFileSync('sprints/b1-demo/config.json','utf8');if(!/\"enabled\"\s*:/.test(c))process.exit(1)"

- [ ] [ARTIFACT] config.json 含 `"entrypoint"` JSON key 字面量
  Test: node -e "const c=require('fs').readFileSync('sprints/b1-demo/config.json','utf8');if(!/\"entrypoint\"\s*:/.test(c))process.exit(1)"

- [ ] [ARTIFACT] config.json 含 `"version"` JSON key 字面量
  Test: node -e "const c=require('fs').readFileSync('sprints/b1-demo/config.json','utf8');if(!/\"version\"\s*:/.test(c))process.exit(1)"

- [ ] [ARTIFACT] config.json 不以非法 trailing comma 收尾
  Test: node -e "const c=require('fs').readFileSync('sprints/b1-demo/config.json','utf8');if(/,\s*[\}\]]/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/config.test.ts`，覆盖：
- parses as valid JSON
- declares module === b1-demo
- declares enabled === true
- exposes non-empty string entrypoint
- keeps version consistent with schema.md
