// 只排除可证明不写脚本的查询来源，不把任意 rg 或文本断言当功能验收。
import { literalWord, unwrapShellCommand } from './shell-command.mjs';

const QUERY = /^\/(?:opt\/homebrew\/bin|usr\/local\/bin|usr\/bin)\/rg[ \t]+--no-config[ \t]+-n[ \t]+-e[ \t]+(.+)[ \t]+--[ \t]+([A-Za-z0-9_./-]+(?:[ \t]+[A-Za-z0-9_./-]+)*)[ \t]*$/;
const FILE = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

export function isReadonlySearchSource(command) {
  if (typeof command !== 'string') return false;
  const source = unwrapShellCommand(command); // 仅一层已知原生 shell 完整封套。
  if (source === null || /[\r\n\0]/.test(source)) return false;
  const match = QUERY.exec(source);
  if (!match || literalWord(match[1].replace(/[ \t]+$/, '')) === null) return false;
  return match[2].trim().split(/[ \t]+/).every(file => FILE.test(file));
}
