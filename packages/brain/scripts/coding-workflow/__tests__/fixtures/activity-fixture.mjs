// runActivity 的测试夹具：按 argv[2] 选择 handler 行为。
import { runActivity } from '../../lib/protocol.mjs';

const mode = process.argv[2];

await runActivity(async (input) => {
  if (mode === 'throw') throw new Error('boom_reason');
  if (mode === 'noise') {
    console.log('noise');
    console.info('noise-info');
    return { status: 'completed', outputs: { echoed: input.run_tag } };
  }
  return { status: 'completed', outputs: { echoed: input.run_tag }, metrics: { n: 1 }, evidence: ['e1'] };
});
