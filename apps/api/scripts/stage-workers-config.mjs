import {copyFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

// API独立产物只携带现有目录的固定副本，真身仍在workflow staff配置。
export function stageWorkersConfig(distRoot=fileURLToPath(new URL('../dist/',import.meta.url))) {
  const directory=join(distRoot,'data/workers');
  mkdirSync(directory,{recursive:true});
  copyFileSync(fileURLToPath(new URL('../../../packages/workflows/staff/workers.config.json',import.meta.url)),join(directory,'workers.config.json'));
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)stageWorkersConfig();
