# Task: Engine ↔ Superpowers 对齐契约 + DevGate 防退化固化

**Task ID**: 4042c0b5-095c-48cc-8eea-923a9e3e6f52
**Branch**: cp-0418193131-superpowers-alignment
**Version**: Engine 14.17.4 → 14.17.5
**Mode**: harness + autonomous

## 目标

把 Engine 与 Superpowers 5.0.7 的对齐状态从"文档引用"升级为"CI 强制验证"，建立防退化契约 + 3 个 DevGate 脚本。

## DoD

### 契约 + 本地化（WS1）

- [x] [ARTIFACT] 契约文件存在
      Test: manual:bash -c "test -f packages/engine/contracts/superpowers-alignment.yaml"

- [x] [ARTIFACT] manifest 文件存在
      Test: manual:bash -c "test -f packages/engine/contracts/prompt-localization-manifest.yaml"

- [x] [BEHAVIOR] 14 skill 全部登记在契约
      Test: manual:node -e "const fs=require('fs');const t=fs.readFileSync('packages/engine/contracts/superpowers-alignment.yaml','utf8');const c=(t.match(/^  - name: /gm)||[]).length;if(c!==14)process.exit(1)"

- [x] [ARTIFACT] 8 个 skill 本地化 prompt 存在
      Test: manual:node -e "['brainstorming','test-driven-development','verification-before-completion','systematic-debugging','subagent-driven-development','receiving-code-review','requesting-code-review','writing-plans'].forEach(s=>{require('fs').accessSync('packages/engine/skills/dev/prompts/'+s+'/SKILL.md')})"

- [x] [ARTIFACT] subagent-driven-development 三角色 prompt 齐全
      Test: manual:node -e "['implementer-prompt.md','spec-reviewer-prompt.md','code-quality-reviewer-prompt.md'].forEach(f=>require('fs').accessSync('packages/engine/skills/dev/prompts/subagent-driven-development/'+f))"

### DevGate 脚本（WS2）

- [x] [ARTIFACT] 3 个 DevGate 脚本存在
      Test: manual:node -e "['packages/engine/scripts/devgate/check-superpowers-alignment.cjs','packages/engine/scripts/devgate/check-engine-hygiene.cjs','packages/engine/scripts/bump-version.sh'].forEach(f=>require('fs').accessSync(f))"

- [x] [BEHAVIOR] alignment gate 脚本通过
      Test: manual:node packages/engine/scripts/devgate/check-superpowers-alignment.cjs

- [x] [BEHAVIOR] hygiene gate 脚本通过
      Test: manual:node packages/engine/scripts/devgate/check-engine-hygiene.cjs

- [x] [BEHAVIOR] bump-version.sh dry-run 正常
      Test: manual:bash packages/engine/scripts/bump-version.sh patch --dry-run

### 违规清理 + CI 集成（WS3）

- [x] [BEHAVIOR] 版本号 5 处同步到 14.17.5
      Test: manual:node -e "const fs=require('fs');const v=fs.readFileSync('packages/engine/VERSION','utf8').trim();const pkg=JSON.parse(fs.readFileSync('packages/engine/package.json','utf8')).version;const hcv=fs.readFileSync('packages/engine/.hook-core-version','utf8').trim();const skill=fs.readFileSync('packages/engine/skills/dev/SKILL.md','utf8').match(/^version:\s*(\S+)/m)[1];const reg=fs.readFileSync('packages/engine/regression-contract.yaml','utf8').match(/^version:\s*(\S+)/m)[1];if(![v,pkg,hcv,skill,reg].every(x=>x==='14.17.5'))process.exit(1)"

- [x] [BEHAVIOR] 无 manual:TODO 占位符残留（devgate 脚本自引用除外）
      Test: manual:node -e "const {execSync}=require('child_process');const r=execSync('grep -rn manual:TODO packages/engine --include=*.md --include=*.sh --include=*.cjs || true').toString().split('\n').filter(l=>l && !l.includes('packages/engine/scripts/devgate/'));if(r.length)process.exit(1)"

- [x] [BEHAVIOR] 无悬空 superpowers: 外部引用
      Test: manual:node -e "const {execSync}=require('child_process');const r=execSync('grep -rn \"superpowers:[a-z-]*/[a-z-]*\\\\.md\" packages/engine/skills || true').toString().trim();if(r)process.exit(1)"

- [x] [BEHAVIOR] 无硬编码 ~/.claude-account3/ 跨账号绝对路径（account1 运行时 fallback 合法，account2/3 不合法）
      Test: manual:node -e "const {execSync}=require('child_process');const r=execSync('grep -rn \"claude-account[23]\" packages/engine/skills --include=*.md || true').toString().trim();if(r)process.exit(1)"

- [x] [BEHAVIOR] CI workflow 含 Superpowers Alignment Gate
      Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('Superpowers Alignment Gate'))process.exit(1)"

- [x] [BEHAVIOR] CI workflow 含 Engine Hygiene Gate
      Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('Engine Hygiene Gate'))process.exit(1)"

- [x] [ARTIFACT] feature-registry.yml 有 14.17.5 条目
      Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/feature-registry.yml','utf8');if(!c.includes('version: \"14.17.5\"'))process.exit(1)"

- [x] [ARTIFACT] Learning 文件存在
      Test: manual:bash -c "test -f docs/learnings/cp-04181931-superpowers-alignment.md"

- [x] [BEHAVIOR] Learning 含根本原因 + 下次预防
      Test: manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-04181931-superpowers-alignment.md','utf8');if(!c.includes('## 根本原因')||!c.includes('## 下次预防'))process.exit(1)"
