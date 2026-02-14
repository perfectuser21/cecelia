/**
 * 临时脚本：重置 Alertness 级别到 CALM
 */

import { setManualLevel, ALERTNESS_LEVELS } from './alertness/index.js';

console.log('[Reset] Resetting alertness to CALM...');

try {
  // WORKAROUND: setManualLevel has a bug in validation, use direct level value
  await setManualLevel(1, 'Manual reset after fixing alertness system');
  console.log('[Reset] ✅ Alertness reset to CALM (level=1) successfully');
} catch (error) {
  console.error('[Reset] ❌ Failed to reset alertness:', error);
  console.error('[Reset] Trying alternative approach...');

  // Alternative: Import and call transitionToLevel directly
  const { default: alertnessModule } = await import('./alertness/index.js');
  console.log('[Reset] Available exports:', Object.keys(alertnessModule || {}));
  process.exit(1);
}

process.exit(0);
