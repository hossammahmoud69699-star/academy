package eg.academy.app

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject

class ApiException(val code: String, val status: Int) : Exception(code)

object ErrorMapper {
    /** يستخرج رمز الخطأ من جسم استجابة الخادم، أو VALIDATION لأخطاء التحقق، أو UNKNOWN. */
    fun parseCode(text: String): String = try {
        val o = Json.parseToJsonElement(text).jsonObject
        val c = (o["code"] as? JsonPrimitive)?.contentOrNull
        c ?: if ((o["statusCode"] as? JsonPrimitive)?.intOrNull == 400) "VALIDATION" else "UNKNOWN"
    } catch (e: Exception) {
        "UNKNOWN"
    }

    fun message(code: String?, status: Int): String = when (code) {
        "NETWORK" -> "تعذّر الاتصال. تحقق من الإنترنت وحاول مرة أخرى"
        "NO_SERVER" -> "اكتب عنوان الخادم أولًا"
        "BAD_URL" -> "عنوان الخادم غير صحيح"
        "BAD_CREDENTIALS" -> "رقم الهاتف أو كلمة المرور غير صحيحة"
        "ACCOUNT_LOCKED" -> "تم إيقاف المحاولات مؤقتًا بسبب محاولات خاطئة كثيرة. حاول بعد 15 دقيقة"
        "ACCOUNT_SUSPENDED" -> "حسابك موقوف. تواصل مع الدعم"
        "DEVICE_MISMATCH" -> "حسابك مرتبط بجهاز آخر. تواصل مع الدعم لإلغاء الربط"
        "DEVICE_REQUIRED" -> "تعذّر التعرف على الجهاز"
        "ALREADY_EXISTS" -> "هذا الحساب مسجّل بالفعل"
        "INVALID_PHONE" -> "رقم الهاتف غير صالح"
        "INVALID_EMAIL" -> "البريد الإلكتروني غير صالح"
        "VALIDATION" -> "تأكد من البيانات المدخلة (كلمة المرور 8 أحرف على الأقل)"
        else -> when {
            status == 429 -> "طلبات كثيرة، انتظر قليلًا ثم حاول مرة أخرى"
            status >= 500 -> "حدث خطأ في الخادم، حاول لاحقًا"
            else -> "حدث خطأ غير متوقع"
        }
    }
}
