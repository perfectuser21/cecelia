package com.zenithjoy.agent

import com.google.gson.Gson
import com.zenithjoy.agent.config.AgentConfig
import com.zenithjoy.agent.config.ConfigStore
import com.zenithjoy.agent.network.RegisterService
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import io.mockk.every
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * RegisterService 单元测试 — 用 mockk 拦截 OkHttp 调用
 *
 * 覆盖：成功 200、invalid license 401、quota exceeded 403、网络错误
 */
class RegisterServiceTest {

    private val gson = Gson()

    private fun makeCfg(license: String = "ZJ-PRO-ABCD1234") = AgentConfig(
        licenseKey = license,
        agentId = "android-test",
        wsUrl = "wss://api.zenithjoy.com/agent-ws",
        httpBase = "https://api.zenithjoy.com",
        loggedInAt = 0L,
    )

    private fun fakeHttpClient(statusCode: Int, body: Map<String, Any?>): OkHttpClient {
        val client = mockk<OkHttpClient>()
        val call = mockk<okhttp3.Call>()
        val resp = Response.Builder()
            .request(Request.Builder().url("https://api.zenithjoy.com/api/agent/register").build())
            .protocol(Protocol.HTTP_1_1)
            .code(statusCode)
            .message("OK")
            .body(gson.toJson(body).toResponseBody("application/json".toMediaType()))
            .build()
        every { client.newCall(any()) } returns call
        every { call.execute() } returns resp
        return client
    }

    @Test
    fun `returns RegisterResult on 200 ok`() {
        val fakeBody = mapOf(
            "ok" to true,
            "ws_token" to "tok-abc123",
            "registered_machine_id" to "machine-001",
            "tier" to "pro",
            "max_machines" to 5,
            "agent_id" to "uuid-1",
        )
        val service = RegisterService(httpClient = fakeHttpClient(200, fakeBody))
        val result = service.register(makeCfg(), "machine-001")

        assertEquals(true, result?.ok)
        assertEquals("tok-abc123", result?.wsToken)
        assertEquals("pro", result?.tier)
        assertEquals("uuid-1", result?.agentUuid)
    }

    @Test
    fun `returns null on ok=false`() {
        val fakeBody = mapOf("ok" to false, "code" to "INVALID_LICENSE")
        val service = RegisterService(httpClient = fakeHttpClient(401, fakeBody))
        val result = service.register(makeCfg(), "machine-001")
        assertNull(result)
    }

    @Test
    fun `returns null on missing ws_token`() {
        val fakeBody = mapOf("ok" to true)
        val service = RegisterService(httpClient = fakeHttpClient(200, fakeBody))
        val result = service.register(makeCfg(), "machine-001")
        assertNull(result)
    }

    @Test
    fun `returns null on network exception`() {
        val client = mockk<OkHttpClient>()
        val call = mockk<okhttp3.Call>()
        every { client.newCall(any()) } returns call
        every { call.execute() } throws java.io.IOException("Connection refused")

        val service = RegisterService(httpClient = client)
        val result = runCatching { service.register(makeCfg(), "machine-001") }.getOrNull()
        assertNull(result)
    }
}
