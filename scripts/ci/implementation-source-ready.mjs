/** 保留旧命令的明确退休结果，不读取collector、Git或凭据。 */
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const retired=()=>{throw Object.assign(Error('工厂消费者来源采集已退役'),{code:'IMPLEMENTATION_CI_FACTORY_COLLECTION_RETIRED',status:410});};
export function expectedSourceRuntime(){retired();}
export async function waitForSourceRuntime(){retired();}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 process.stderr.write('IMPLEMENTATION_CI_FACTORY_COLLECTION_RETIRED\n');process.exitCode=1;
}
