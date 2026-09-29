package expo.modules.breakingnews

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BreakingNewsModule : Module() {
  private val context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  private val playbackReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      when (intent?.action) {
        BreakingNewsService.ACTION_PAUSE ->
          sendEvent("pause", mapOf("reason" to (intent.getStringExtra("reason") ?: "interrupt")))
        BreakingNewsService.ACTION_RESUME -> sendEvent("resume", emptyMap<String, Any>())
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("BreakingNews")

    Events("pause", "resume")

    OnCreate {
      val filter = IntentFilter().apply {
        addAction(BreakingNewsService.ACTION_PAUSE)
        addAction(BreakingNewsService.ACTION_RESUME)
      }
      if (Build.VERSION.SDK_INT >= 33) {
        context.registerReceiver(playbackReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
      } else {
        context.registerReceiver(playbackReceiver, filter)
      }
    }

    OnDestroy {
      runCatching { context.unregisterReceiver(playbackReceiver) }
    }

    Function("canDrawOverlays") {
      Settings.canDrawOverlays(context)
    }

    Function("start") { apiUrl: String, token: String ->
      val intent = Intent(context, BreakingNewsService::class.java)
        .putExtra(BreakingNewsService.EXTRA_API_URL, apiUrl)
        .putExtra(BreakingNewsService.EXTRA_TOKEN, token)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    Function("stop") {
      context.stopService(Intent(context, BreakingNewsService::class.java))
    }

    Function("status") {
      mapOf("running" to BreakingNewsService.running, "lastError" to BreakingNewsService.lastError)
    }
  }
}
