import { fileURLToPath } from 'node:url';
// 旧测试只替换被测文件；节点策略必须继续读取真实受控配置。
const profilePath = fileURLToPath(new URL('../../../config/fleet-node-profiles.json', import.meta.url));
export function preserveFleetConfigFs(actual, overrides) {
  return { ...actual, ...overrides, readFileSync(file, ...args) {
    const filename = file instanceof URL ? fileURLToPath(file) : String(file);
    return filename === profilePath ? actual.readFileSync(file, ...args) : overrides.readFileSync(file, ...args);
  } };
}
