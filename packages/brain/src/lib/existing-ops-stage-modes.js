/** 经审B补丁的完整模式变体；不读候选自身声明来扩大允许范围。 */
import {STAGE_ENVELOPES} from './existing-ops-stage-envelopes.js';
const SKILLS_PROFILE = {
  "key": "zenithjoy-skills",
  "default": false,
  "enabled": true,
  "slug": "perfectuser21/zenithjoy-skills",
  "origin": "https://github.com/perfectuser21/zenithjoy-skills.git",
  "aliases": [
    "zenithjoy-skills"
  ],
  "clone": "~/perfect21/zenithjoy-skills-cw-runner",
  "worktree_base": "~/worktrees/zenithjoy-skills-cw",
  "state_ns": "zenithjoy-skills",
  "required_checks": [
    "lint-skills"
  ],
  "base_fresh_check": null,
  "install": [
    "python3",
    "--version"
  ],
  "qa_smoke": null,
  "version_fragment": null,
  "preview": {
    "type": "local"
  },
  "production_re": [
    ":5200\\b",
    "100\\.86\\.118\\.99",
    "\\bhk-vps\\b",
    "\\b(?:mmv|xian-m4)\\b",
    "\\badb\\b"
  ],
  "automerge": false,
  "prechecks": "skills",
  "rules_prompt": "prompts/repo-rules/skills.md"
};
const base=STAGE_ENVELOPES.mode;
const repos=JSON.parse(base['repos.json']);
export const REVIEWED_STAGE_MODES=Object.freeze([base,{
 ...base,
 'lib/repo-profile.mjs':base['lib/repo-profile.mjs'].replace("['cecelia', 'zenithjoy']", "['cecelia', 'zenithjoy', 'skills']"),
 'repos.json':JSON.stringify({...repos,repos:[...repos.repos,SKILLS_PROFILE]}),
}]);

// 只改变Cecelia登记的必需汇总名，其余完整仓库模式保持已审Skills变体。
export const BASIC_CI_STAGE_MODE=Object.freeze({
 ...REVIEWED_STAGE_MODES[1],
 'repos.json':JSON.stringify({...JSON.parse(REVIEWED_STAGE_MODES[1]['repos.json']),repos:JSON.parse(REVIEWED_STAGE_MODES[1]['repos.json']).repos.map(repo=>
  repo.key==='cecelia'?{...repo,required_checks:['源码保底通过'],base_fresh_check:null}:repo)}),
});
