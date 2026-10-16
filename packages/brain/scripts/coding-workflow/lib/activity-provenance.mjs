// 仅可信活动入口选择阶段；任务 JSON 不得选择证据根、controller 身份或跳过封存。
import fs from 'node:fs';
import path from 'node:path';
import { withRecordProvenance, controllerIdentity, provenanceRequired, sealStageEvidence } from './record-provenance.mjs';

const FIXED_REPORTS = {
  intent: ['01-intent.md', '01-invariants.md'],
  spec: ['02-spec.md'],
  build: ['03-build.md'],
  verify: ['04-evidence.md'],
  spec_review: ['02-review.md'],
};

function stageFiles(input, stage) {
  const { worktree, sprint_dir: sprint } = input;
  if (stage !== 'evaluate') return (FIXED_REPORTS[stage] ?? []).map(file => `${sprint}/${file}`);
  const files = [`${sprint}/05-qa-report-r${input.round}.md`];
  const shots = `${sprint}/qa-r${input.round}`;
  const walk = (rel) => {
    const full = path.join(worktree, rel);
    let stat;
    try { stat = fs.lstatSync(full); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (stat.isSymbolicLink()) throw new Error('provenance_path_symlink');
    if (stat.isFile()) files.push(rel);
    else if (stat.isDirectory()) for (const name of fs.readdirSync(full)) walk(`${rel}/${name}`);
    else throw new Error('provenance_file_invalid');
  };
  walk(shots);
  return files;
}

export async function runRecordedActivity(input, options, handler) {
  const { stage, entry, root } = options;
  if (!provenanceRequired(input.worktree)) return handler(input);
  // 与 evaluate 的既有默认口径一致，身份与文件名必须使用同一个实际轮次。
  if (stage === 'evaluate') input = { ...input,
    round: Number.isInteger(Number(input.round)) && Number(input.round) > 0 ? Number(input.round) : 1 };
  const controller = controllerIdentity(entry, [import.meta.url, new URL('./claude.mjs', import.meta.url)]);
  return withRecordProvenance({ worktree: input.worktree, taskId: input.task_id,
    sprintDir: input.sprint_dir, stage, round: input.round ?? 0, controller, ...(root ? { root } : {}) }, async () => {
    const result = await handler(input);
    if (result?.status === 'completed' && stage !== 'publish') {
      const sealed = sealStageEvidence({ files: stageFiles(input, stage), result,
        producer: stage === 'intent' ? 'controller' : 'model',
        ...(stage === 'intent' ? { controllerInput: { task_id: input.task_id, result } } : {}) });
      if (stage === 'evaluate') return { ...result, outputs: { ...result.outputs, source_stage_event_id: sealed.id } };
    }
    return result;
  });
}
