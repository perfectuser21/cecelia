# DoD: Autonomous Research Proxy Layer (Engine v14.14.0)

## Artifacts

- [x] [ARTIFACT] `packages/engine/skills/dev/steps/autonomous-research-proxy.md` 存在且包含 Tier 1/2/3 交互点替换清单
  - Test: `node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/autonomous-research-proxy.md','utf8');if(!c.includes('Tier 1'))process.exit(1)"`

- [x] [ARTIFACT] SKILL.md 版本升至 7.2.0，包含 autonomous-research-proxy 加载说明
  - Test: `node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/SKILL.md','utf8');if(!c.includes('7.2.0')||!c.includes('autonomous-research-proxy'))process.exit(1)"`

- [x] [ARTIFACT] Engine 版本 bump 6 文件同步（package.json/lock/VERSION/.hook-core-version/regression-contract.yaml/feature-registry.yml）
  - Test: `node -e "const v=require('fs').readFileSync('packages/engine/VERSION','utf8').trim();if(!v.includes('14.14.0'))process.exit(1)"`

## Behaviors

- [x] [BEHAVIOR] Research Subagent 调用模板包含 5 项外部锚点（Code/OKR/Decisions/Learnings/First-principles）
  - Test: `tests/skills/research-proxy-integration.test.ts`

- [x] [BEHAVIOR] Confidence 三档处理规则：high→继续, medium→PR标注, low→暂停+创Brain task
  - Test: `tests/skills/research-proxy-integration.test.ts`

- [x] [BEHAVIOR] 00.7-decision-query v1.1.0 重塑为 Research Subagent 查询工具
  - Test: `tests/skills/research-proxy-integration.test.ts`
