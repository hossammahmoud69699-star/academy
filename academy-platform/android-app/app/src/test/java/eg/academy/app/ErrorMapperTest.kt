package eg.academy.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ErrorMapperTest {
    @Test
    fun parsesServerCode() {
        assertEquals("DEVICE_MISMATCH", ErrorMapper.parseCode("""{"code":"DEVICE_MISMATCH","message":"x"}"""))
    }

    @Test
    fun validationErrorWithoutCode() {
        val body = """{"message":["password must be longer"],"error":"Bad Request","statusCode":400}"""
        assertEquals("VALIDATION", ErrorMapper.parseCode(body))
    }

    @Test
    fun nonJsonBodyIsUnknown() {
        assertEquals("UNKNOWN", ErrorMapper.parseCode("<html>oops</html>"))
        assertEquals("UNKNOWN", ErrorMapper.parseCode(""))
    }

    @Test
    fun messagesAreArabicAndSpecific() {
        assertTrue(ErrorMapper.message("DEVICE_MISMATCH", 403).contains("جهاز آخر"))
        assertTrue(ErrorMapper.message("NETWORK", 0).contains("الإنترنت"))
        assertTrue(ErrorMapper.message("UNKNOWN", 429).contains("انتظر"))
        assertTrue(ErrorMapper.message("UNKNOWN", 500).contains("الخادم"))
    }
}
