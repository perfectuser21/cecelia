// 仓库忽略规则可能忽略 QA 报告（如 macOS ignorecase + *REPORT*.md）。
// 只有当前任务/轮次的记录可 force-add；不改变仓库忽略规则或 Git 配置。
import fs from 'node:fs';
import path from 'node:path';
import { registerRecordSources } from '../../lib/record-sources.mjs';
import { git } from './proc.mjs';
import { beginRecordRegistration, observeRecordRegistration } from '../../lib/record-provenance.mjs';

export async function stageQaRecords(worktree, { sprintDir, taskId, round }, records, provenance = null) {
  const relative = (p) => typeof p === 'string' && p.length > 0 && !p.includes('\\')
    && !/[\x00-\x1f\x7f]/.test(p) && !path.isAbsolute(p)
    && p.split('/').every((part) => part && part !== '.' && part !== '..' && part.toLowerCase() !== '.git');
  if (!relative(sprintDir) || !/^sprints\/[^/]+$/.test(sprintDir)
    || typeof taskId !== 'string' || !/^[a-f0-9]{8}-/.test(taskId)
    || !sprintDir.endsWith(`-cw-${taskId.slice(0, 8)}`)
    || !Number.isSafeInteger(round) || round < 1 || !Array.isArray(records)) throw new Error('qa_record_path_invalid');
  const reports = [`${sprintDir}/05-qa-report-r${round}.md`, `${sprintDir}/06-judge-r${round}.md`];
  const shots = `${sprintDir}/qa-r${round}`;
  // 先验证整个列表，再触碰索引；路径只能是固定报告或本轮截图根目录。
  if (records.some((p) => !relative(p) || ![...reports, shots].includes(p))) throw new Error('qa_record_path_invalid');
  const root = fs.realpathSync(worktree);
  const files = [];
  const inspect = (rel, allowDirectory) => {
    const full = path.join(root, rel);
    // 任一祖先为链接也拒绝，包括指向仓内的链接，避免 Git 路径解释与文件系统漂移。
    let current = root;
    for (const part of rel.split('/')) {
      current = path.join(current, part);
      if (!fs.existsSync(current)) {
        try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('qa_record_path_invalid'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        return;
      }
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('qa_record_path_invalid');
    }
    const stat = fs.lstatSync(full);
    if (stat.isFile()) { files.push(rel); return; }
    if (!allowDirectory || !stat.isDirectory()) throw new Error('qa_record_path_invalid');
    for (const name of fs.readdirSync(full)) {
      const child = `${rel}/${name}`;
      if (!relative(child)) throw new Error('qa_record_path_invalid');
      inspect(child, true);
    }
  };
  for (const record of records) inspect(record, record === shots);
  if (files.length === 0) throw new Error('qa_records_empty');
  if ((await git(worktree, ['diff', '--cached', '--quiet'])).code !== 0) throw new Error('qa_records_index_not_empty');
  const registration = provenance ? beginRecordRegistration(provenance, files) : null;
  const markdown = files.filter(file => reports.includes(file));
  const sourceFiles = markdown.length ? registerRecordSources(worktree, { taskId, sprintDir, stage: 'qa', round }, markdown) : [];
  if (registration) observeRecordRegistration(registration, sourceFiles);
  if ((await git(worktree, ['--literal-pathspecs', 'add', '-f', '--', ...new Set([...files, ...sourceFiles])])).code !== 0) throw new Error('qa_report_add_failed');
  return { files, registration };
}

/** 既有 QA 记录规则：顶层版本碎片、本任务 05/06/07 报告及 qa-rN 产物；不是整个 sprint。 */
export function isRecordFile(file, branch) {
  if (/^changes\/[^/]+\.md$/.test(file)) return true;
  const id8 = /-cw-([a-f0-9]{8})$/.exec(String(branch ?? ''))?.[1];
  if (!id8) return false;
  return new RegExp(`^sprints/[^/]+-cw-${id8}/(05-qa-report-r\\d+\\.md|06-judge-r\\d+\\.md|07-commander-r\\d+\\.md|qa-r\\d+/.+)$`).test(file);
}
