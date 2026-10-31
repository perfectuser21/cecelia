// 仅测试使用：保存真实构造的夹具；每次 fork 都拥有独立目录和 Git 对象。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function directorySnapshot(root) {
  const original = fs.realpathSync(root);
  const template = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cw-fixture-snapshot-')));
  const copy = destination => fs.cpSync(template, destination, { recursive: true, mode: fs.constants.COPYFILE_FICLONE });
  try { fs.cpSync(original, template, { recursive: true, mode: fs.constants.COPYFILE_FICLONE }); }
  catch (error) { fs.rmSync(template, { recursive: true, force: true });throw error; }
  return {
    fork() {
      const destination = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cw-fixture-fork-')));
      try {
        copy(destination);
        // 来源事件和 Git 对象必须逐字节保留，不重写凭证字段。
        return destination;
      } catch (error) { fs.rmSync(destination, { recursive: true, force: true });throw error; }
    },
    cleanup: () => fs.rmSync(template, { recursive: true, force: true }),
  };
}
