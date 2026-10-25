package eg.academy.app

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** تخزين مشفّر (Android Keystore) للتوكنات وعنوان الخادم. لا تُخزَّن كلمة المرور إطلاقًا. */
class SessionStore(context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "session",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    var serverUrl: String
        get() = prefs.getString("server_url", "") ?: ""
        set(v) = prefs.edit().putString("server_url", v.trim()).apply()

    var accessToken: String?
        get() = prefs.getString("access", null)
        set(v) = prefs.edit().putString("access", v).apply()

    var refreshToken: String?
        get() = prefs.getString("refresh", null)
        set(v) = prefs.edit().putString("refresh", v).apply()

    fun clearTokens() {
        prefs.edit().remove("access").remove("refresh").apply()
    }
}
