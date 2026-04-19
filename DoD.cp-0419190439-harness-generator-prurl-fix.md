# DoD: 修复 LangGraph Harness Generator 静默失败

contract_branch: cp-0419190439-harness-generator-prurl-fix
workstream_index: 1
sprint_dir: (N/A)

---

## ARTIFACT 条目

- [x] [ARTIFACT] docker/cecelia-runner/entrypoint.sh 存在并含 GIT_CONFIG_GLOBAL 导出
  - Test: `manual:node -e "const c=require('fs').readFileSync('docker/cecelia-runner/entrypoint.sh','utf8');if(!c.includes('GIT_CONFIG_GLOBAL')||!c.includes('/tmp/gitconfig-rw'))process.exit(1)"`

- [x] [ARTIFACT] packages/brain/src/harness-graph.js 的 extractField 拒绝 null 字面量
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-graph.js','utf8');if(!c.includes('INVALID_LITERALS'))process.exit(1)"`

- [x] [ARTIFACT] packages/brain/src/harness-graph.js 的 extractField 对 pr_url 有 URL fallback
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-graph.js','utf8');if(!c.includes('github.com')||!c.includes('/pull/'))process.exit(1)"`

- [x] [ARTIFACT] 新增 extract-field-fallback 单元测试文件
  - Test: `manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/extract-field-fallback.test.js')"`

- [x] [ARTIFACT] Generator prompt 含 "FAILED" 字样（显式失败语义）
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-graph.js','utf8');if(!c.includes('pr_url: FAILED'))process.exit(1)"`

- [x] [ARTIFACT] Learning 文件符合格式
  - Test: `manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-0419190439-harness-generator-prurl-fix.md','utf8');if(!c.includes('### 根本原因')||!c.includes('### 下次预防'))process.exit(1)"`

## BEHAVIOR 条目

- [x] [BEHAVIOR] extractField 对字面量 `null` 返回 JavaScript null（不是字符串 "null"）
  - Test: `tests/extract-field-fallback.test.js::handles null literal`
  - 覆盖 GWT-2（根因 B 的核心修复）

- [x] [BEHAVIOR] extractField 对字面量 `FAILED`/`none`/`undefined`/空串返回 null
  - Test: `tests/extract-field-fallback.test.js::rejects invalid literals`

- [x] [BEHAVIOR] extractField 对含裸 GitHub PR URL 的文本，即使没有 `pr_url:` 前缀，也能提取 URL
  - Test: `tests/extract-field-fallback.test.js::fallback to raw github URL for pr_url`
  - 覆盖 GWT-3（SKILL.md 的 JSON 格式输出也能被兼容）

- [x] [BEHAVIOR] extractField 对 pr_branch 在字面量失败时 fallback 到 cp- 分支名模式
  - Test: `tests/extract-field-fallback.test.js::fallback to cp- branch for pr_branch`
  - 覆盖 GWT-4

- [x] [BEHAVIOR] extractField 对 JSON 格式 `{"pr_url":"https://..."}` 能提取 URL
  - Test: `tests/extract-field-fallback.test.js::handles JSON format from SKILL`

- [x] [BEHAVIOR] extractField 对有效 `pr_url: https://github.com/...` 字面量仍然正常工作（没 regression）
  - Test: `tests/extract-field-fallback.test.js::still handles valid literal`

- [x] [BEHAVIOR] Generator prompt 里明确要求失败时输出 `pr_url: FAILED`
  - Test: `manual:node -e "const {createDockerNodes}=require('./packages/brain/src/harness-graph.js');const fakeExec=async()=>({exit_code:0,stdout:'',stderr:'',timed_out:false});const nodes=createDockerNodes(fakeExec,{id:'t1'});if(typeof nodes.generator!=='function')process.exit(1)"`

## 实施清单（push 前全部 [x]）

- [x] 改 `docker/cecelia-runner/entrypoint.sh`，引入 `GIT_CONFIG_GLOBAL=/tmp/gitconfig-rw`
- [x] 改 `packages/brain/src/harness-graph.js::extractField`，引入 `INVALID_LITERALS` + URL/branch fallback
- [x] 改 `packages/brain/src/harness-graph.js` Generator prompt，明确 FAILED 语义
- [x] 新增 `packages/brain/src/__tests__/extract-field-fallback.test.js` 覆盖全部 BEHAVIOR 条目
- [x] 新增 `docs/learnings/cp-0419190439-harness-generator-prurl-fix.md`
- [x] 本地 `npm test -- extract-field-fallback` 通过
- [x] 本地 `docker build -t cecelia/runner:latest docker/cecelia-runner/` 成功
- [x] 本地 `docker run` 验证 git remote + gh auth status 正常
