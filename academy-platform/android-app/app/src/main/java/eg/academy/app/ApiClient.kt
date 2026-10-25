package eg.academy.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiClient(private val store: SessionStore) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val mediaJson = "application/json; charset=utf-8".toMediaType()
    private val refreshLock = Mutex()

    private suspend fun raw(method: String, path: String, body: String?, token: String?): String =
        withContext(Dispatchers.IO) {
            val base = store.serverUrl.trim().trimEnd('/')
            if (base.isEmpty()) throw ApiException("NO_SERVER", 0)
            val builder = try {
                Request.Builder().url(base + path)
            } catch (e: IllegalArgumentException) {
                throw ApiException("BAD_URL", 0)
            }
            if (token != null) builder.header("Authorization", "Bearer $token")
            val requestBody = if (method == "GET") null else (body ?: "").toRequestBody(mediaJson)
            builder.method(method, requestBody)
            try {
                http.newCall(builder.build()).execute().use { resp ->
                    val text = resp.body?.string().orEmpty()
                    if (resp.isSuccessful) text else throw ApiException(ErrorMapper.parseCode(text), resp.code)
                }
            } catch (e: IOException) {
                throw ApiException("NETWORK", 0)
            }
        }

    /** طلب بتوكن؛ عند 401 يحاول تجديد التوكن مرة واحدة ثم يعيد الطلب. */
    private suspend fun authed(method: String, path: String, body: String? = null): String {
        try {
            return raw(method, path, body, store.accessToken)
        } catch (e: ApiException) {
            if (e.status == 401 && refreshTokens()) {
                return raw(method, path, body, store.accessToken)
            }
            throw e
        }
    }

    private suspend fun refreshTokens(): Boolean = refreshLock.withLock {
        val rt = store.refreshToken ?: return false
        try {
            val text = raw("POST", "/auth/refresh", json.encodeToString(RefreshRequest(rt)), null)
            val res = json.decodeFromString<RefreshResponse>(text)
            store.accessToken = res.accessToken
            store.refreshToken = res.refreshToken
            true
        } catch (e: ApiException) {
            if (e.status == 401) store.clearTokens()
            false
        }
    }

    suspend fun register(fullName: String, identifier: String, password: String) {
        raw("POST", "/auth/register", json.encodeToString(RegisterRequest(fullName, identifier, password)), null)
    }

    suspend fun login(identifier: String, password: String, d: DeviceData): LoginResponse {
        val req = LoginRequest(identifier, password, d.fingerprint, d.model, d.osVersion, d.appVersion)
        return json.decodeFromString<LoginResponse>(raw("POST", "/auth/login", json.encodeToString(req), null))
    }

    suspend fun me(): Me = json.decodeFromString<Me>(authed("GET", "/me"))

    suspend fun devices(): List<DeviceInfo> =
        json.decodeFromString<List<DeviceInfo>>(authed("GET", "/me/devices"))

    suspend fun logout() {
        authed("POST", "/auth/logout")
    }
}
