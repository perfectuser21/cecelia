/**
 * Perception Signals 路由
 *
 * GET /api/brain/perception-signals
 *   返回：16 个感知信号的当前值 + 元数据
 *   数据来源：实时运行 runPerception()，附加静态元数据（重要性、是否有消费者）
 */

import { Router } from 'express';
import pool from '../db.js';
import { runPerception } from '../desire/perception.js';

const router = Router();

// 16 个感知信号元数据（静态定义）
const SIGNAL_META = [
  { id: 'task_fail_rate_24h',   label: '任务24h失败率',   importance: 7, hasConsumer: true  },
  { id: 'queue_buildup',        label: '队列积压',        importance: 6, hasConsumer: true  },
  { id: 'kr_stalled',           label: 'KR进度停滞',      importance: 8, hasConsumer: true  },
  { id: 'kr_status_snapshot',   label: '活跃目标快照',    importance: 5, hasConsumer: true  },
  { id: 'hours_since_feishu',   label: '距上次飞书交互',  importance: 6, hasConsumer: true  },
  { id: 'system_idle',          label: '系统空闲',        importance: 4, hasConsumer: true  },
  { id: 'user_online',          label: '用户在线',        importance: 7, hasConsumer: true  },
  { id: 'undigested_knowledge', label: '未消化知识',      importance: 6, hasConsumer: true  },
  { id: 'repeated_failures',    label: '连续失败模式',    importance: 8, hasConsumer: true  },
  { id: 'task_milestone',       label: '任务里程碑',      importance: 7, hasConsumer: true  },
  { id: 'task_completed_today', label: '今日完成数',      importance: 5, hasConsumer: false },
  { id: 'time_aware_greeting',  label: '时间感知问候',    importance: 2, hasConsumer: false },
  { id: 'learning_gap_signal',  label: '知识盲点',        importance: 7, hasConsumer: true  },
  { id: 'conversation_quality', label: '对话质量',        importance: 6, hasConsumer: true  },
  { id: 'curiosity_accumulated',label: '好奇心积累',      importance: 8, hasConsumer: true  },
  { id: 'intellectual_idle',    label: '好奇心饥渴',      importance: 7, hasConsumer: false },
];

router.get('/', async (_req, res) => {
  try {
    const observations = await runPerception(pool);

    const signals = SIGNAL_META.map(meta => {
      const obs = observations.find(o => o.signal === meta.id);
      return {
        ...meta,
        value: obs?.value ?? null,
        context: obs?.context ?? null,
        observed: obs !== undefined,
      };
    });

    res.json({ signals, snapshot_at: new Date().toISOString() });
  } catch (err) {
    console.error('[API] perception-signals error:', err.message);
    // 降级：返回空值列表，不阻断前端
    const signals = SIGNAL_META.map(meta => ({
      ...meta,
      value: null,
      context: null,
      observed: false,
    }));
    res.json({ signals, snapshot_at: new Date().toISOString(), error: err.message });
  }
});

export default router;
