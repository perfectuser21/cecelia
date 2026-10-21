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
