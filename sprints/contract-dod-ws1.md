# Contract DoD — Workstream 1: Initiative B1 入口模块 + 默认配置

**范围**: 新建 `initiatives/b1/entry.js` 与 `initiatives/b1/config/default.json`，构成可独立启动的入口 + 默认配置；不涉及 verify.sh 与 README
**大小**: S（< 80 LOC）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] 入口模块文件 `initiatives/b1/entry.js` 存在
  Test: node -e "require('fs').accessSync('initiatives/b1/entry.js')"

- [ ] [ARTIFACT] 默认配置文件 `initiatives/b1/config/default.json` 存在
  Test: node -e "require('fs').accessSync('initiatives/b1/config/default.json')"

- [ ] [ARTIFACT] 默认配置为合法 JSON
  Test: node -e "JSON.parse(require('fs').readFileSync('initiatives/b1/config/default.json','utf8'))"

- [ ] [ARTIFACT] 默认配置含 `banner` 字段且为非空字符串
  Test: node -e "const c=JSON.parse(require('fs').readFileSync('initiatives/b1/config/default.json','utf8'));if(typeof c.banner!=='string'||c.banner.length===0)process.exit(1)"

- [ ] [ARTIFACT] 入口源码引用相对路径 `config/default.json`（确保通过相对路径而非硬编码绝对路径加载）
  Test: node -e "const c=require('fs').readFileSync('initiatives/b1/entry.js','utf8');if(!/config\/default\.json/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 入口源码包含至少一个非零 `process.exit` 语句（用于错误路径，禁止只有 exit(0) 的"假完成"）
  Test: node -e "const c=require('fs').readFileSync('initiatives/b1/entry.js','utf8');if(!/process\.exit\([1-9]\d*\)/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `sprints/tests/ws1/entry.test.ts`，覆盖：
- exits with code 0 when invoked with no arguments
- prints recognizable Initiative B1 banner to stdout
- echoes config.banner field value into stdout on startup
- exits non-zero with readable error when default config file is missing
- exits non-zero with readable error when banner field is missing from config
- produces identical exit code and stdout on repeated invocation
