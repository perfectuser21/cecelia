/** 运行根只从冻结 release 推导；任务输入不参与路径或 shell 选择。 */
import { requireCommander } from './commander-v2-contract.js';
export const PRODUCTION_COMMANDER_ROOT = '~/.openclaw/commander';
const REPO = 'perfectuser21/zenithjoy-workspace';
const CANDIDATE_ROOT = /^~\/\.local\/share\/zenithjoy\/phone-candidates\/([a-f0-9]{40})\/runtime\/commander$/;
export function runtimeRootFromRelease(release) {
  requireCommander(release && typeof release.environment === 'string', '冻结release缺environment');
  if (release.environment === 'production') return PRODUCTION_COMMANDER_ROOT;
  const sha = /^staging:([a-f0-9]{40})$/.exec(release.environment)?.[1];
  requireCommander(sha, '候选release环境必须为staging:完整SHA');
  const components = release.payload?.components;
  requireCommander(Array.isArray(components) && components.length > 0
    && components.filter(c => c.kind === 'repo').length === 1
    && components.every(c => ['repo', 'code', 'skill'].includes(c.kind) && c.repo === REPO && c.revision === sha),
  '候选release来源必须同仓且固定同一SHA');
  return `~/.local/share/zenithjoy/phone-candidates/${sha}/runtime/commander`;
}
export function commanderRuntimeRoot(envelope) {
  // 历史生产信封没有 execution_location；新信封位置一旦存在不得缺列。
  if (envelope.execution_location === undefined) return PRODUCTION_COMMANDER_ROOT;
  const root = envelope.execution_location?.runtime_root;
  requireCommander(typeof root === 'string' && (root === PRODUCTION_COMMANDER_ROOT || CANDIDATE_ROOT.test(root)), '冻结Commander runtime_root非法');
  return root;
}
export function commanderRuntimeHelpers(envelope) {
  const root = commanderRuntimeRoot(envelope);
  const helpers = { report: `${root}/wf-report.py`, commander: `${root}/wf-v2.py` };
  const sha = CANDIDATE_ROOT.exec(root)?.[1];
  if (sha && envelope.workflow_key === 'douyin_video_publish.android') {
    helpers.publish_skill = `~/.local/share/zenithjoy/publish-releases/${sha}/.agents/skills/multi-platform-publish/SKILL.md`;
  }
  return helpers;
}
export function validateExecutionLocation(control) {
  const location = control.envelope.execution_location;
  commanderRuntimeRoot(control.envelope);
  if (location) for (const key of ['ssh_target', 'run_directory', 'runtime_root']) {
    requireCommander(location[key] === control.execution_location?.[key], `冻结执行位置漂移:${key}`, 409);
  }
}
