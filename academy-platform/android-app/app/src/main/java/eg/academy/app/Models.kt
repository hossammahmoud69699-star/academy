package eg.academy.app

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class LoginRequest(
    val identifier: String,
    val password: String,
    val deviceFingerprint: String,
    val deviceModel: String,
    val osVersion: String,
    val appVersion: String,
)

@Serializable
data class UserBrief(val id: String, val fullName: String, val role: String)

@Serializable
data class LoginResponse(val accessToken: String, val refreshToken: String, val user: UserBrief)

@Serializable
data class RefreshRequest(val refreshToken: String)

@Serializable
data class RefreshResponse(val accessToken: String, val refreshToken: String)

@Serializable
data class RegisterRequest(val fullName: String, val identifier: String, val password: String)

/** استجابة GET /me (أسماء الحقول من قاعدة البيانات بصيغة snake_case). */
@Serializable
data class Me(
    val id: String,
    @SerialName("full_name") val fullName: String,
    val phone: String? = null,
    val email: String? = null,
    val role: String,
)

@Serializable
data class DeviceInfo(
    val id: String,
    val model: String? = null,
    val status: String,
)

data class DeviceData(
    val fingerprint: String,
    val model: String,
    val osVersion: String,
    val appVersion: String,
)
