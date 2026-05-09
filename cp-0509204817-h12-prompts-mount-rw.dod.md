# DoD: H12 cecelia-prompts mount ro→rw

## 验收清单

- [x] [BEHAVIOR] buildDockerArgs 输出 cecelia-prompts mount 字段是 :rw
  Test: tests/brain/h12-prompts-mount-rw.test.js

- [x] [ARTIFACT] docker-executor.js 不含 'cecelia-prompts:ro'，含 'cecelia-prompts:rw'
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8');if(c.includes('cecelia-prompts:ro'))process.exit(1);if(!c.includes('cecelia-prompts:rw'))process.exit(1)"

- [x] [ARTIFACT] 测试文件存在
  Test: manual:node -e "require('fs').accessSync('tests/brain/h12-prompts-mount-rw.test.js')"

## Learning

文件: docs/learnings/cp-0509204817-h12-prompts-mount-rw.md

## 测试命令

```bash
npx vitest run tests/brain/h12-prompts-mount-rw.test.js
```
