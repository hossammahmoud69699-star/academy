package eg.academy.app

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Light = lightColorScheme(
    primary = Color(0xFF1F4FD8),
    onPrimary = Color.White,
    secondary = Color(0xFF0E7C66),
    background = Color(0xFFF7F8FC),
    surface = Color(0xFFF7F8FC),
    error = Color(0xFFB3261E),
)

private val Dark = darkColorScheme(
    primary = Color(0xFF8AB4FF),
    onPrimary = Color(0xFF0B1B44),
    secondary = Color(0xFF5FD3B8),
    background = Color(0xFF10131A),
    surface = Color(0xFF10131A),
    error = Color(0xFFF2B8B5),
)

/** يتبع وضع النظام (ليلي/نهاري). */
@Composable
fun AcademyTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, content = content)
}
