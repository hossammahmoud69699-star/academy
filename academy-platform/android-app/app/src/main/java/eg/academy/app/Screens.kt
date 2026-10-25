package eg.academy.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

@Composable
fun AppRoot(vm: AppViewModel) {
    when (vm.screen) {
        Screen.Splash -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        Screen.Login -> LoginScreen(vm)
        Screen.Register -> RegisterScreen(vm)
        Screen.Home -> HomeScreen(vm)
    }
}

@Composable
private fun FormColumn(title: String, content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
    ) {
        Text(title, style = MaterialTheme.typography.headlineMedium)
        content()
    }
}

@Composable
private fun ServerField(vm: AppViewModel) {
    OutlinedTextField(
        value = vm.serverUrl,
        onValueChange = { vm.updateServer(it) },
        label = { Text("عنوان الخادم (للتجربة)") },
        placeholder = { Text("https://...") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun ErrorText(vm: AppViewModel) {
    vm.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
}

@Composable
private fun SubmitButton(text: String, enabled: Boolean, busy: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled && !busy,
        modifier = Modifier
            .fillMaxWidth()
            .height(52.dp),
    ) {
        if (busy) CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.dp) else Text(text)
    }
}

@Composable
fun LoginScreen(vm: AppViewModel) {
    var id by remember { mutableStateOf("") }
    var pw by remember { mutableStateOf("") }
    FormColumn("تسجيل الدخول") {
        ServerField(vm)
        OutlinedTextField(
            value = id,
            onValueChange = { id = it },
            label = { Text("رقم الهاتف أو البريد الإلكتروني") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = pw,
            onValueChange = { pw = it },
            label = { Text("كلمة المرور") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
        )
        ErrorText(vm)
        SubmitButton("دخول", id.isNotBlank() && pw.isNotEmpty(), vm.busy) { vm.login(id, pw) }
        TextButton(onClick = { vm.goTo(Screen.Register) }, modifier = Modifier.fillMaxWidth()) {
            Text("ليس لديك حساب؟ إنشاء حساب")
        }
    }
}

@Composable
fun RegisterScreen(vm: AppViewModel) {
    var name by remember { mutableStateOf("") }
    var id by remember { mutableStateOf("") }
    var pw by remember { mutableStateOf("") }
    FormColumn("إنشاء حساب طالب") {
        ServerField(vm)
        OutlinedTextField(
            value = name,
            onValueChange = { name = it },
            label = { Text("الاسم بالكامل") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = id,
            onValueChange = { id = it },
            label = { Text("رقم الهاتف أو البريد الإلكتروني") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = pw,
            onValueChange = { pw = it },
            label = { Text("كلمة المرور (8 أحرف على الأقل)") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
        )
        ErrorText(vm)
        SubmitButton("إنشاء الحساب", name.trim().length >= 3 && id.isNotBlank() && pw.length >= 8, vm.busy) {
            vm.register(name, id, pw)
        }
        TextButton(onClick = { vm.goTo(Screen.Login) }, modifier = Modifier.fillMaxWidth()) {
            Text("لدي حساب بالفعل")
        }
    }
}

private fun roleLabel(role: String) = when (role) {
    "admin" -> "مدير النظام"
    "content_manager" -> "مدير محتوى"
    "teacher" -> "مدرس"
    else -> "طالب"
}

@Composable
fun HomeScreen(vm: AppViewModel) {
    val me = vm.me
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("أهلًا ${me?.fullName ?: ""}", style = MaterialTheme.typography.headlineMedium)
        if (me != null) Text(roleLabel(me.role), color = MaterialTheme.colorScheme.secondary)

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("الجهاز المرتبط", style = MaterialTheme.typography.titleMedium)
                val active = vm.devices.firstOrNull { it.status == "active" }
                if (active != null) {
                    Text("${active.model ?: "جهاز"} • مرتبط بحسابك")
                } else {
                    Text("لا يوجد جهاز مرتبط")
                }
            }
        }

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("الكورسات", style = MaterialTheme.typography.titleMedium)
                Text("لا توجد كورسات بعد. ستظهر هنا بعد إضافة محتوى الأكاديمية (المرحلة 4).")
            }
        }

        Spacer(Modifier.height(8.dp))
        OutlinedButton(
            onClick = { vm.logout() },
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
        ) { Text("تسجيل الخروج") }
    }
}
