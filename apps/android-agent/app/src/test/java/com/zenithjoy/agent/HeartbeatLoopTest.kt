package com.zenithjoy.agent

import com.google.gson.Gson
import com.zenithjoy.agent.config.AgentConfig
import com.zenithjoy.agent.network.HeartbeatLoop
import com.zenithjoy.agent.network.HeartbeatTask
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * HeartbeatLoop 单元测试
 *
 * 覆盖：响应解析、queued_tasks 分发、agent_id 缓存
 */
@OptIn(ExperimentalCoroutinesApi::class)
class HeartbeatLoopTest {

    private val gson = Gson()

    private fun makeCfg() = AgentConfig(
        licenseKey = "ZJ-PRO-ABCD1234",
        agentId = "android-test",
        wsUrl = "wss://api.zenithjoy.com/agent-ws",
        httpBase = "https://api.zenithjoy.com",
        loggedInAt = 0L,
        agentUuid = "uuid-001",
    )

    private fun fakeClient(body: Map<String, Any?>): OkHttpClient {
        val client = mockk<OkHttpClient>()
        val call = mockk<okhttp3.Call>()
        val resp = Response.Builder()
            .request(Request.Builder().url("https://api.zenithjoy.com/api/agent/heartbeat").build())
            .protocol(Protocol.HTTP_1_1)
            .code(200)
            .message("OK")
            .body(gson.toJson(body).toResponseBody("application/json".toMediaType()))
            .build()
        every { client.newCall(any()) } returns call
        every { call.execute() } returns resp
        return client
    }

    @Test
    fun `dispatches queued tasks via onTask callback`() = runTest {
        val received = mutableListOf<HeartbeatTask>()
        val latch = CountDownLatch(1)

        val fakeBody = mapOf(
            "ok" to true,
            "agent_id" to "server-agent-001",
            "queued_tasks" to listOf(
                mapOf("task_id" to "t1", "platform" to "douyin", "type" to "video", "payload" to emptyMap<String, Any>())
            ),
        )

        val loop = HeartbeatLoop(
            cfg = makeCfg(),
            machineId = "machine-001",
            intervalMs = 1_000_000L,
            httpClient = fakeClient(fakeBody),
            onTask = {
                received.add(it)
                latch.countDown()
            },
        )

        loop.start(this)
        latch.await(3, TimeUnit.SECONDS)
        loop.stop()

        assertEquals(1, received.size)
        assertEquals("t1", received[0].taskId)
        assertEquals("douyin", received[0].platform)
    }

    @Test
    fun `calls onError when response not ok`() = runTest {
        val errors = mutableListOf<Throwable>()
        val latch = CountDownLatch(1)

        val fakeBody = mapOf("ok" to false, "agent_id" to null)

        val loop = HeartbeatLoop(
            cfg = makeCfg(),
            machineId = "machine-001",
            intervalMs = 1_000_000L,
            httpClient = fakeClient(fakeBody),
            onError = {
                errors.add(it)
                latch.countDown()
            },
        )

        loop.start(this)
        latch.await(3, TimeUnit.SECONDS)
        loop.stop()

        assertEquals(1, errors.size)
    }
}
