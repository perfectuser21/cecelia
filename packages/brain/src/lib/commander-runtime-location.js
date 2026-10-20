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

/** 候选父会话也必须读候选 Skill；全局旧 Skill 的绝对路径不能决定本次执行。 */
export function commanderLaunchMessage(envelope) {
  const root = commanderRuntimeRoot(envelope), raw = JSON.stringify(envelope);
  if (root === PRODUCTION_COMMANDER_ROOT) return raw;
  return `这是 Brain 冻结候选运行的执行指令。先在冻结宿主通过 gateway_exec 读取 ${root}/skills/workflow-commander/SKILL.md，按该版本规程执行。
本次 execution_location.runtime_root=${root} 是父 Commander 全链唯一根；候选 Skill 中的旧全局路径必须替换为此根。禁止回落生产或全局 Skill，不修改任何现场文件。候选文件缺失或校验失败即保留阻塞。
原始信封保持字节内容与所有字段，不把本指令写进信封。照规程用结构化 env 安全保存并读回完整信封，取得真实 parent session。所有命令经 gateway_exec 在冻结宿主运行；业务值、路径和 JSON 只经结构化 env，不拼接 shell。将 runtime_root 的 ~/ 展开为该宿主 HOME 后使用。
入口与后续操作全部固定：
- ${root}/wf-launch.sh --ready：stdin 必须是原始信封的 {definition,workflow_key,execution_location}，不可丢 execution_location；核对 ready 和所有冻结摘要。
- ${root}/wf-launch.sh --envelope：使用已读回的信封路径及真实 --parent-session，继续原有 action 状态机。
- ${root}/wf-v2.py claim-spawn：领取唯一派发；同文件 event/replay 上报及重放。
- ${root}/wf-agent-handoff.py bind/await：原官方子会话回执绑定与持续等待。
- ${root}/wf-status.sh：读回同 run 状态；${root}/wf-report.py：写本 run 报告。
所有步骤沿用冻结预算、身份、资源和活动合同；不可因目录变化重新 spawn、改 run 或放宽核验。
原始信封JSON：
${raw}`;
}
