# Contract DoD — Workstream 1: schema.md

**范围**: 产出 `sprints/b1-demo/schema.md`，声明 b1-demo 模块的 module/version/fields 三段契约
**大小**: S（< 30 行）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] 文件 `sprints/b1-demo/schema.md` 存在
  Test: node -e "require('fs').accessSync('sprints/b1-demo/schema.md')"

- [ ] [ARTIFACT] schema.md 含 `module: b1-demo` 字面量声明
  Test: node -e "const c=require('fs').readFileSync('sprints/b1-demo/schema.md','utf8');if(!/^module:\s*b1-demo\s*$/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] schema.md 含 `version:` 字段且为 semver 格式
  Test: node -e "const c=require('fs').readFileSync('sprints/b1-demo/schema.md','utf8');if(!/^version:\s*\d+\.\d+\.\d+\s*$/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] schema.md 含二级标题 `## Fields`
  Test: node -e "const c=require('fs').readFileSync('sprints/b1-demo/schema.md','utf8');if(!/^##\s+Fields\s*$/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] schema.md 总行数 ≥ 10（非空 stub 防伪）
  Test: node -e "const c=require('fs').readFileSync('sprints/b1-demo/schema.md','utf8');if(c.split('\n').length<10)process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/schema.test.ts`，覆盖：
- declares module identifier as b1-demo
- declares semver-compliant version
- lists at least 3 fields under Fields section
- rejects empty or single-line stub schema
