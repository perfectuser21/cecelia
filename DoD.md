# DoD: LangGraph 节点内联 SKILL 内容

- [x] [ARTIFACT] harness-graph.js 含 loadSkillContent 函数
  File: packages/brain/src/harness-graph.js
  Check: exports loadSkillContent

- [x] [BEHAVIOR] 6 个节点全部用 loadSkillContent 替换 /slash
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-graph.js','utf8');const m=c.match(/\/harness-(planner|contract|generator|evaluator|report)/g);if(m)process.exit(1)"

- [x] [BEHAVIOR] loadSkillContent 缓存 + 多目录查找
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-graph.js','utf8');if(!c.includes('SKILL_SEARCH_DIRS'))process.exit(1);if(!c.includes('_skillCache'))process.exit(1)"
