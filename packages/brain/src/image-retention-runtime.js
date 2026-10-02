import { access } from 'node:fs/promises';
export async function loadImageRetentionEngine() {
  // 镜像内/app/scripts与仓库根scripts是固定打包位置，不从HTTP或任务payload加载代码。
  let module = new URL('../scripts/brain-image-retention/runtime.mjs', import.meta.url);
  try { await access(module); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    module = new URL('../../../scripts/brain-image-retention/runtime.mjs', import.meta.url);
  }
  const { createRuntime } = await import(module.href);
  return (await createRuntime())?.engine ?? null;
}
