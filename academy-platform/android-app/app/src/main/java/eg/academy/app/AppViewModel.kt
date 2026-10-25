package eg.academy.app

import android.app.Application
import android.os.Build
import android.provider.Settings
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch

sealed interface Screen {
    data object Splash : Screen
    data object Login : Screen
    data object Register : Screen
    data object Home : Screen
}

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val store = SessionStore(app)
    private val api = ApiClient(store)

    var screen by mutableStateOf<Screen>(Screen.Splash)
        private set
    var busy by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var serverUrl by mutableStateOf(store.serverUrl)
        private set
    var me by mutableStateOf<Me?>(null)
        private set
    var devices by mutableStateOf<List<DeviceInfo>>(emptyList())
        private set

    init {
        restoreSession()
    }

    fun updateServer(url: String) {
        serverUrl = url
        store.serverUrl = url
    }

    fun goTo(s: Screen) {
        error = null
        screen = s
    }

    private fun device() = DeviceData(
        // ANDROID_ID ثابت لكل جهاز وتطبيق؛ الخادم يخزّن تجزئته فقط
        fingerprint = Settings.Secure.getString(getApplication<Application>().contentResolver, Settings.Secure.ANDROID_ID)
            ?: "unknown",
        model = Build.MODEL ?: "unknown",
        osVersion = Build.VERSION.RELEASE ?: "",
        appVersion = BuildConfig.VERSION_NAME,
    )

    private fun restoreSession() {
        viewModelScope.launch {
            if (store.refreshToken == null) {
                screen = Screen.Login
                return@launch
            }
            try {
                loadHome()
                screen = Screen.Home
            } catch (e: ApiException) {
                if (e.status == 401) store.clearTokens()
                error = ErrorMapper.message(e.code, e.status)
                screen = Screen.Login
            }
        }
    }

    private suspend fun loadHome() {
        me = api.me()
        devices = api.devices()
    }

    private fun run(block: suspend () -> Unit) {
        viewModelScope.launch {
            busy = true
            error = null
            try {
                block()
            } catch (e: ApiException) {
                error = ErrorMapper.message(e.code, e.status)
                if (e.status == 401 && screen == Screen.Home) {
                    store.clearTokens()
                    screen = Screen.Login
                }
            } finally {
                busy = false
            }
        }
    }

    private suspend fun doLogin(identifier: String, password: String) {
        val r = api.login(identifier, password, device())
        store.accessToken = r.accessToken
        store.refreshToken = r.refreshToken
        loadHome()
        screen = Screen.Home
    }

    fun login(identifier: String, password: String) = run { doLogin(identifier.trim(), password) }

    fun register(fullName: String, identifier: String, password: String) = run {
        api.register(fullName.trim(), identifier.trim(), password)
        doLogin(identifier.trim(), password)
    }

    fun logout() {
        viewModelScope.launch {
            try {
                api.logout()
            } catch (e: ApiException) {
                // الخروج المحلي يتم حتى لو تعذّر الاتصال
            }
            store.clearTokens()
            me = null
            devices = emptyList()
            error = null
            screen = Screen.Login
        }
    }
}
