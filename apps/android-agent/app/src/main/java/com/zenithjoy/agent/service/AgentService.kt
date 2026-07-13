package com.zenithjoy.agent.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder
import com.zenithjoy.agent.R
import com.zenithjoy.agent.config.AgentConfig
import com.zenithjoy.agent.config.ConfigStore
import com.zenithjoy.agent.fingerprint.MachineFingerprint
import com.zenithjoy.agent.network.HeartbeatLoop
import com.zenithjoy.agent.network.RegisterService
import com.zenithjoy.agent.network.WsClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * 后台常驻服务：注册 → WS 连接 + HTTP 心跳双通道。
 *
 * 启动顺序：
 *   1. 读 config（licenseKey 必须已由 SetupActivity 写入）
 *   2. 计�� machineId（Android ID + 型号 SHA256）
 *   3. 调 POST /api/agent/register，获取 ws_token（同一机器重启续签同一记录）
 *   4. 启动 WsClient（WS 心跳 15s）
 *   5. 启动 HeartbeatLoop（HTTP 心跳 30s，轮询队列任务）
 */
class AgentService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var wsClient: WsClient? = null
    private var heartbeatLoop: HeartbeatLoop? = null

    override fun onCreate() {
        super.onCreate()
        startForeground(NOTIFICATION_ID, buildNotification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        scope.launch { bootAgent() }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        wsClient?.disconnect()
        heartbeatLoop?.stop()
        super.onDestroy()
    }

    private suspend fun bootAgent() {
        val store = ConfigStore(applicationContext)
        val cfg = store.load() ?: run {
            stopSelf()
            return
        }

        val machineId = cfg.machineId ?: MachineFingerprint.compute(applicationContext)

        val registeredCfg = ensureRegistered(cfg, machineId, store) ?: cfg

        wsClient = WsClient(
            cfg = registeredCfg,
            onStateChange = { state ->
                android.util.Log.d(TAG, "WS state: $state")
            },
            onMessage = { msg ->
                android.util.Log.d(TAG, "WS message: ${msg["type"]}")
            },
        )

        heartbeatLoop = HeartbeatLoop(
            cfg = registeredCfg,
            machineId = machineId,
            onTask = { task ->
                android.util.Log.d(TAG, "queued task: ${task.taskId} / ${task.platform}")
            },
            onError = { err ->
                android.util.Log.w(TAG, "heartbeat error: ${err.message}")
            },
        )

        wsClient?.connect()
        heartbeatLoop?.start(scope)
    }

    private fun ensureRegistered(
        cfg: AgentConfig,
        machineId: String,
        store: ConfigStore,
    ): AgentConfig? {
        if (cfg.wsToken != null && cfg.machineId != null) return cfg

        val result = runCatching {
            RegisterService().register(cfg, machineId)
        }.getOrNull() ?: return null

        val updated = cfg.copy(
            wsToken = result.wsToken,
            machineId = result.machineId,
            tier = result.tier,
            maxMachines = result.maxMachines,
            agentUuid = result.agentUuid,
        )
        store.save(updated)
        return updated
    }

    private fun buildNotification(): Notification {
        val channelId = "agent_service"
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(
                channelId,
                getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_MIN,
            )
        )
        return Notification.Builder(this, channelId)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.notification_text))
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .build()
    }

    companion object {
        private const val TAG = "AgentService"
        private const val NOTIFICATION_ID = 1001
    }
}
