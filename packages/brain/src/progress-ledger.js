/**
 * Progress Ledger - 任务执行进展追踪模块
 *
 * 提供任务执行过程中的步骤记录、进展评估、异常检测功能
 * 在 execution-callback 和 tick 循环中集成使用
 *
 * @module progress-ledger
 */

import pool from './db.js';

// 简单的 logger 实现（如果没有专门的 logger 文件）
const logger = {
  debug: (msg, meta) => console.log(`[DEBUG] ${msg}`, meta || ''),
  info: (msg, meta) => console.log(`[INFO] ${msg}`, meta || ''),
  warn: (msg, meta) => console.warn(`[WARN] ${msg}`, meta || ''),
  error: (msg, meta) => console.error(`[ERROR] ${msg}`, meta || '')
};

/**
 * 记录任务执行步骤
 *
 * @param {string} taskId - 任务 ID
 * @param {string} runId - 运行 ID（来自 execution-callback）
 * @param {Object} step - 步骤信息
 * @param {number} step.sequence - 步骤序号
 * @param {string} step.name - 步骤名称
 * @param {string} [step.type='execution'] - 步骤类型
 * @param {string} [step.status='queued'] - 步骤状态
 * @param {Date} [step.startedAt] - 开始时间
 * @param {Date} [step.completedAt] - 完成时间
 * @param {number} [step.durationMs] - 执行耗时（毫秒）
 * @param {string} [step.inputSummary] - 输入摘要
 * @param {string} [step.outputSummary] - 输出摘要
 * @param {Object} [step.findings={}] - 步骤发现
 * @param {string} [step.errorCode] - 错误代码
 * @param {string} [step.errorMessage] - 错误消息
 * @param {number} [step.retryCount=0] - 重试次数
 * @param {Object} [step.artifacts={}] - 工件信息
 * @param {Object} [step.metadata={}] - 元数据
 * @param {number} [step.confidenceScore=1.0] - 信心分数 (0.0-1.0)
 * @returns {Promise<number>} 新创建的记录 ID
 * @throws {Error} 数据库操作失败时抛出异常
 */
async function recordProgressStep(taskId, runId, step) {
    try {
        const {
            sequence,
            name,
            type = 'execution',
            status = 'queued',
            startedAt,
            completedAt,
            durationMs,
            inputSummary,
            outputSummary,
            findings = {},
            errorCode,
            errorMessage,
            retryCount = 0,
            artifacts = {},
            metadata = {},
            confidenceScore = 1.0
        } = step;

        // 参数验证
        if (!taskId || !runId || !sequence || !name) {
            throw new Error('Missing required parameters: taskId, runId, sequence, name');
        }

        if (confidenceScore < 0.0 || confidenceScore > 1.0) {
            throw new Error('confidenceScore must be between 0.0 and 1.0');
        }

        const query = `
            INSERT INTO progress_ledger (
                task_id, run_id, step_sequence, step_name, step_type,
                status, started_at, completed_at, duration_ms,
                input_summary, output_summary, findings,
                error_code, error_message, retry_count,
                artifacts, metadata, confidence_score
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            ON CONFLICT (task_id, run_id, step_sequence)
            DO UPDATE SET
                step_name = EXCLUDED.step_name,
                status = EXCLUDED.status,
                completed_at = EXCLUDED.completed_at,
                duration_ms = EXCLUDED.duration_ms,
                output_summary = EXCLUDED.output_summary,
                findings = EXCLUDED.findings,
                error_code = EXCLUDED.error_code,
                error_message = EXCLUDED.error_message,
                retry_count = EXCLUDED.retry_count,
                confidence_score = EXCLUDED.confidence_score,
                updated_at = NOW()
            RETURNING id
        `;

        const values = [
            taskId, runId, sequence, name, type,
            status, startedAt, completedAt, durationMs,
            inputSummary, outputSummary, JSON.stringify(findings),
            errorCode, errorMessage, retryCount,
            JSON.stringify(artifacts), JSON.stringify(metadata), confidenceScore
        ];

        const result = await pool.query(query, values);
        const ledgerId = result.rows[0].id;

        logger.debug(`Progress step recorded: task=${taskId}, run=${runId}, sequence=${sequence}, status=${status}`);
        return ledgerId;

    } catch (error) {
        logger.error(`Failed to record progress step: ${error.message}`, {
            taskId, runId, step: step.name, error
        });
        throw error;
    }
}

/**
 * 获取任务的进展步骤历史
 *
 * @param {string} taskId - 任务 ID
 * @param {string} [runId] - 运行 ID，如果未指定则返回所有运行的步骤
 * @returns {Promise<Array>} 步骤记录数组
 */
async function getProgressSteps(taskId, runId = null) {
    try {
        let query = `
            SELECT * FROM progress_ledger
            WHERE task_id = $1
        `;
        const values = [taskId];

        if (runId) {
            query += ` AND run_id = $2`;
            values.push(runId);
        }

        query += ` ORDER BY step_sequence ASC, created_at ASC`;

        const result = await pool.query(query, values);
        return result.rows.map(row => ({
            ...row,
            findings: typeof row.findings === 'string' ? JSON.parse(row.findings) : row.findings,
            artifacts: typeof row.artifacts === 'string' ? JSON.parse(row.artifacts) : row.artifacts,
            metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
        }));

    } catch (error) {
        logger.error(`Failed to get progress steps: ${error.message}`, { taskId, runId, error });
        throw error;
    }
}

/**
 * 更新进展步骤
 *
 * @param {number} ledgerId - 记录 ID
 * @param {Object} updates - 更新内容
 * @returns {Promise<boolean>} 更新成功返回 true
 */
async function updateProgressStep(ledgerId, updates) {
    try {
        const setParts = [];
        const values = [];
        let paramIndex = 1;

        // 动态构建更新字段
        const allowedFields = [
            'status', 'completed_at', 'duration_ms', 'output_summary',
            'findings', 'error_code', 'error_message', 'retry_count',
            'confidence_score'
        ];

        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                if (key === 'findings' || key === 'artifacts' || key === 'metadata') {
                    setParts.push(`${key} = $${paramIndex}`);
                    values.push(JSON.stringify(value));
                } else {
                    setParts.push(`${key} = $${paramIndex}`);
                    values.push(value);
                }
                paramIndex++;
            }
        }

        if (setParts.length === 0) {
            logger.warn(`No valid fields to update for ledger ${ledgerId}`);
            return false;
        }

        const query = `
            UPDATE progress_ledger
            SET ${setParts.join(', ')}, updated_at = NOW()
            WHERE id = $${paramIndex}
        `;
        values.push(ledgerId);

        const result = await pool.query(query, values);
        return result.rowCount > 0;

    } catch (error) {
        logger.error(`Failed to update progress step: ${error.message}`, { ledgerId, updates, error });
        throw error;
    }
}

/**
 * 获取任务进展摘要
 *
 * @param {string} taskId - 任务 ID
 * @returns {Promise<Object>} 进展摘要对象
 */
async function getTaskProgressSummary(taskId) {
    try {
        const query = `
            SELECT * FROM v_task_progress_summary
            WHERE task_id = $1
            ORDER BY first_step_started DESC
            LIMIT 1
        `;

        const result = await pool.query(query, [taskId]);
        if (result.rows.length === 0) {
            return {
                taskId,
                totalSteps: 0,
                completedSteps: 0,
                completionPercentage: 0,
                totalDurationMs: 0,
                avgConfidence: 1.0
            };
        }

        const summary = result.rows[0];
        return {
            taskId,
            runId: summary.run_id,
            totalSteps: parseInt(summary.total_steps),
            completedSteps: parseInt(summary.completed_steps),
            failedSteps: parseInt(summary.failed_steps),
            inProgressSteps: parseInt(summary.in_progress_steps),
            completionPercentage: parseFloat(summary.completion_percentage),
            totalDurationMs: parseInt(summary.total_duration_ms) || 0,
            avgConfidence: parseFloat(summary.avg_confidence),
            firstStepStarted: summary.first_step_started,
            lastStepCompleted: summary.last_step_completed
        };

    } catch (error) {
        logger.error(`Failed to get task progress summary: ${error.message}`, { taskId, error });
        throw error;
    }
}

/**
 * 在 Tick 循环中评估任务进展
 * 检测异常任务（停滞、过慢、重试过多）并记录评估结果
 *
 * @param {string} tickId - Tick ID
 * @param {number} tickNumber - Tick 序号
 * @returns {Promise<Array>} 评估结果数组
 */
async function evaluateProgressInTick(tickId, tickNumber) {
    try {
        logger.debug(`Starting progress evaluation for tick ${tickNumber}`);

        // 查询所有 in_progress 任务的最新进展
        const tasksQuery = `
            SELECT DISTINCT t.id as task_id, t.title, t.status as task_status,
                   pl.run_id, pl.step_sequence, pl.step_name, pl.status as step_status,
                   pl.started_at, pl.completed_at, pl.retry_count, pl.confidence_score,
                   EXTRACT(EPOCH FROM (NOW() - pl.started_at)) * 1000 as step_age_ms
            FROM tasks t
            JOIN progress_ledger pl ON pl.task_id = t.id
            WHERE t.status = 'in_progress'
            AND pl.id IN (
                SELECT MAX(id) FROM progress_ledger
                WHERE task_id = t.id
                GROUP BY task_id, run_id
            )
        `;

        const tasksResult = await pool.query(tasksQuery);
        const evaluationResults = [];

        // 异常检测阈值配置
        const STALLED_THRESHOLD_MS = 60 * 60 * 1000; // 1 小时
        const SLOW_STEP_THRESHOLD_MULTIPLIER = 2; // 2x 估计时间
        const HIGH_RETRY_THRESHOLD = 3; // 3 次重试

        for (const task of tasksResult.rows) {
            const { task_id, run_id, step_sequence, step_name, step_status,
                   started_at, retry_count, confidence_score, step_age_ms } = task;

            let reviewAction = 'continue';
            let reviewReason = 'Task progressing normally';
            let riskAssessment = 'low';
            let shouldAlert = false;

            // 1. 进展停滞检测
            if (step_status === 'in_progress' && step_age_ms > STALLED_THRESHOLD_MS) {
                reviewAction = 'escalate';
                reviewReason = `Step '${step_name}' has been running for ${Math.round(step_age_ms / 60000)} minutes without completion`;
                riskAssessment = 'high';
                shouldAlert = true;
            }

            // 2. 步骤过慢检测（简化版，实际可基于历史数据）
            else if (step_status === 'in_progress' && step_age_ms > (30 * 60 * 1000 * SLOW_STEP_THRESHOLD_MULTIPLIER)) {
                reviewAction = 'retry';
                reviewReason = `Step '${step_name}' is taking longer than expected`;
                riskAssessment = 'medium';
            }

            // 3. 失败重试过多检测
            else if (retry_count >= HIGH_RETRY_THRESHOLD) {
                reviewAction = 'pause';
                reviewReason = `Step '${step_name}' has failed ${retry_count} times, pausing for review`;
                riskAssessment = 'high';
                shouldAlert = true;
            }

            // 4. 低信心分数检测
            else if (confidence_score < 0.5) {
                reviewAction = 'escalate';
                reviewReason = `Step '${step_name}' has low confidence score (${confidence_score})`;
                riskAssessment = 'medium';
            }

            // 记录评估结果到数据库
            const reviewQuery = `
                INSERT INTO progress_ledger_review (
                    task_id, run_id, ledger_entry_id, tick_id, tick_number,
                    review_action, review_reason, risk_assessment,
                    ai_model, ai_decision
                )
                SELECT $1, $2, pl.id, $3, $4, $5, $6, $7, $8, $9
                FROM progress_ledger pl
                WHERE pl.task_id = $1 AND pl.run_id = $2 AND pl.step_sequence = $10
                LIMIT 1
            `;

            const aiDecision = {
                tickId,
                tickNumber,
                evaluatedAt: new Date().toISOString(),
                stepAge: step_age_ms,
                retryCount: retry_count,
                confidenceScore: confidence_score,
                thresholds: {
                    stalledThresholdMs: STALLED_THRESHOLD_MS,
                    highRetryThreshold: HIGH_RETRY_THRESHOLD
                }
            };

            await pool.query(reviewQuery, [
                task_id, run_id, tickId, tickNumber,
                reviewAction, reviewReason, riskAssessment,
                'decision_engine', JSON.stringify(aiDecision),
                step_sequence
            ]);

            evaluationResults.push({
                taskId: task_id,
                runId: run_id,
                stepName: step_name,
                reviewAction,
                reviewReason,
                riskAssessment,
                shouldAlert
            });

            // 记录日志
            if (riskAssessment !== 'low') {
                logger.warn(`Progress evaluation alert: ${reviewReason}`, {
                    taskId: task_id, runId: run_id, stepName: step_name,
                    riskAssessment, reviewAction
                });
            }
        }

        logger.info(`Progress evaluation completed for tick ${tickNumber}: evaluated ${evaluationResults.length} tasks`, {
            tickId, tickNumber,
            alertCount: evaluationResults.filter(r => r.shouldAlert).length
        });

        return evaluationResults;

    } catch (error) {
        logger.error(`Failed to evaluate progress in tick: ${error.message}`, { tickId, tickNumber, error });
        throw error;
    }
}

/**
 * 获取异常任务列表
 *
 * @param {number} hoursWindow - 时间窗口（小时）
 * @returns {Promise<Array>} 异常任务列表
 */
async function getProgressAnomalies(hoursWindow = 1) {
    try {
        const query = `
            SELECT DISTINCT plr.task_id, t.title, plr.run_id,
                   plr.review_action, plr.review_reason, plr.risk_assessment,
                   plr.created_at as evaluated_at,
                   pl.step_name, pl.status as step_status,
                   pl.retry_count, pl.confidence_score
            FROM progress_ledger_review plr
            JOIN tasks t ON t.id = plr.task_id
            JOIN progress_ledger pl ON pl.id = plr.ledger_entry_id
            WHERE plr.created_at >= NOW() - INTERVAL '${hoursWindow} hours'
            AND plr.risk_assessment IN ('medium', 'high')
            ORDER BY plr.risk_assessment DESC, plr.created_at DESC
        `;

        const result = await pool.query(query);
        return result.rows.map(row => ({
            taskId: row.task_id,
            taskTitle: row.title,
            runId: row.run_id,
            stepName: row.step_name,
            stepStatus: row.step_status,
            reviewAction: row.review_action,
            reviewReason: row.review_reason,
            riskAssessment: row.risk_assessment,
            retryCount: row.retry_count,
            confidenceScore: parseFloat(row.confidence_score),
            evaluatedAt: row.evaluated_at
        }));

    } catch (error) {
        logger.error(`Failed to get progress anomalies: ${error.message}`, { hoursWindow, error });
        throw error;
    }
}

export {
    recordProgressStep,
    getProgressSteps,
    updateProgressStep,
    getTaskProgressSummary,
    evaluateProgressInTick,
    getProgressAnomalies
};