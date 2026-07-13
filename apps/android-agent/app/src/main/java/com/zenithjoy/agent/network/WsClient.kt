package com.zenithjoy.agent.network

import com.google.gson.Gson
import com.zenithjoy.agent.config.AgentConfig
import com.zenithjoy.agent.config.ConfigStore
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * WS 客户端 — 对齐 zenithjoy/services/agent/src/index.ts#connect 协议：
 *
 *   连接：wss://api.zenithjoy.com/agent-ws?token=<licenseKey>
 *   open  → 发 hello：{ type:"hello", payload:{ agentId, agentUuid?, version, capabilities } }
 *   loop  → 每 15s WS 心跳：{ type:"heartbeat", payload:{ uptime, busy:false } }
 *   close → 指数退避重连（1s → 2s → … → 30s）
 */
class WsClient(
    private val cfg: AgentConfig,
    private val httpClient: OkHttpClient = buildWsHttpClient(),
    private val gson: Gson = Gson(),
    private val onMessage: ((Map<*, *>) -> Unit)? = null,
    private val onStateChange: ((State) -> Unit)? = null,
) {
    enum class State { CONNECTING, OPEN, CLOSED }

    private val startTime = System.currentTimeMillis()
    private var ws: WebSocket? = null
    private var backoffMs = 1_000L
    private var heartbeatRunning = false
    private val heartbeatThread = Thread.ofVirtual().name("ws-heartbeat").unstarted(::heartbeatLoop)

    fun connect() {
        val token = URLEncoder.encode(cfg.licenseKey, "UTF-8")
        val url = "${cfg.wsUrl}?token=$token"
        onStateChange?.invoke(State.CONNECTING)

        val req = Request.Builder().url(url).build()
        ws = httpClient.newWebSocket(req, listener)
    }

    fun disconnect() {
        heartbeatRunning = false
        ws?.close(1000, "shutdown")
        ws = null
    }

    private val listener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            onStateChange?.invoke(State.OPEN)
            backoffMs = 1_000L
            webSocket.send(gson.toJson(buildHello()))
            startHeartbeat(webSocket)
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            runCatching {
                @Suppress("UNCHECKED_CAST")
                val msg = gson.fromJson(text, Map::class.java) as Map<*, *>
                onMessage?.invoke(msg)
            }
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
            onMessage(webSocket, bytes.utf8())
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            onStateChange?.invoke(State.CLOSED)
            heartbeatRunning = false
            scheduleReconnect()
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            onStateChange?.invoke(State.CLOSED)
            heartbeatRunning = false
            scheduleReconnect()
        }
    }

    private fun startHeartbeat(socket: WebSocket) {
        if (heartbeatRunning) return
        heartbeatRunning = true
        if (!heartbeatThread.isAlive) {
            heartbeatThread.start()
        }
    }

    private fun heartbeatLoop() {
        while (heartbeatRunning) {
            Thread.sleep(15_000)
            val socket = ws ?: break
            if (!heartbeatRunning) break
            val payload = mapOf(
                "uptime" to (System.currentTimeMillis() - startTime),
                "busy" to false,
            )
            socket.send(gson.toJson(makeMsg("heartbeat", payload)))
        }
    }

    private fun scheduleReconnect() {
        val delay = backoffMs
        backoffMs = minOf(backoffMs * 2, MAX_BACKOFF_MS)
        Thread.sleep(delay)
        connect()
    }

    private fun buildHello(): Map<String, Any?> {
        val payload = mutableMapOf<String, Any?>(
            "agentId" to cfg.agentId,
            "version" to ConfigStore.VERSION,
            "capabilities" to listOf("android"),
        )
        cfg.agentUuid?.let { payload["agentUuid"] = it }
        return makeMsg("hello", payload)
    }

    private fun makeMsg(type: String, payload: Any): Map<String, Any?> = mapOf(
        "type" to type,
        "taskId" to null,
        "payload" to payload,
    )

    companion object {
        private const val MAX_BACKOFF_MS = 30_000L

        fun buildWsHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .pingInterval(20, TimeUnit.SECONDS)
            .build()
    }
}
