package expo.modules.breakingnews

import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.text.TextUtils
import android.util.Base64
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

// Polls the Family Hub API for alerts and shows them as an L-shaped "breaking news" ticker over
// whatever app is on screen. One-shot alerts slide in for a few seconds; sticky alerts (departure
// countdowns) stay while the server keeps returning them, and the "interrupt" stage pauses playback
// and waits for the remote's OK (or the phone's "I've left"); either one resumes playback.
class BreakingNewsService : Service() {
  companion object {
    const val EXTRA_API_URL = "apiUrl"
    const val EXTRA_TOKEN = "token"
    const val ACTION_PAUSE = "com.familyhub.tv.PAUSE"
    const val ACTION_RESUME = "com.familyhub.tv.RESUME"
    private const val TAG = "BreakingNews"
    private const val CHANNEL_ID = "breaking-news"
    private const val NOTIFICATION_ID = 4201
    private const val POLL_SECONDS = 30L
    private const val MIN_SHOW_MS = 12_000L
    private const val MAX_SHOW_MS = 25_000L
    private const val MS_PER_CHAR = 90L
    private const val SLIDE_MS = 450L
    private const val INTERRUPT_MAX_MS = 90_000L
    private const val SEEN_LIMIT = 200

    @Volatile var running = false
      private set
    @Volatile var lastError: String? = null
      private set
  }

  private data class Alert(
    val id: String,
    val group: String?,
    val level: String,
    val text: String,
    val sticky: Boolean,
    val secondsLeft: Long?,
    val pause: Boolean,
    val ack: Boolean,
    val eventId: String?,
    val image: Bitmap?,
    val caption: String?,
  )

  // The one window we draw into, and what it currently shows.
  private inner class Ticker(val alert: Alert, val root: FrameLayout, val side: LinearLayout, val bottom: LinearLayout,
                             val headline: TextView, val label: TextView, val big: TextView, val small: TextView) {
    var deadline: Long? = null
    var removal: Runnable? = null
    var countdown: Runnable? = null
    // False once the interrupt gave up waiting: nobody answered, so nobody is watching either.
    var resumeOnExit = true
  }

  private val main = Handler(Looper.getMainLooper())
  private var poller: ScheduledExecutorService? = null
  private var apiUrl = ""
  private var token = ""
  private val queue = ArrayDeque<Alert>()
  // One-shot alerts waiting in the queue or on screen; only touched on the main thread.
  private val pending = HashSet<String>()
  // Sticky alerts the server wants on screen right now, by group.
  private var wanted = LinkedHashMap<String, Alert>()
  // Sticky alert ids that were acknowledged or timed out locally; ignored until the server moves on.
  private val handled = HashSet<String>()
  private var ticker: Ticker? = null
  // Whether the interrupt paused another app's playback (so resuming may press play there).
  private var otherAppPaused = false
  // Group of an interrupt that timed out with playback still paused. The person leaving usually taps
  // "I've left" on the phone minutes later; when the server reports that departure, playback resumes.
  private var awaitingDeparture: String? = null
  private lateinit var windowManager: WindowManager

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    startInForeground()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val url = intent?.getStringExtra(EXTRA_API_URL)
    val tok = intent?.getStringExtra(EXTRA_TOKEN)
    if (url == null || tok == null) {
      lastError = "Service started without API URL or token"
      Log.e(TAG, lastError!!)
      stopSelf()
      return START_NOT_STICKY
    }
    apiUrl = url.trimEnd('/')
    token = tok
    poller?.shutdownNow()
    poller = Executors.newSingleThreadScheduledExecutor().also {
      it.scheduleWithFixedDelay({ poll() }, 0, POLL_SECONDS, TimeUnit.SECONDS)
    }
    running = true
    return START_REDELIVER_INTENT
  }

  override fun onDestroy() {
    poller?.shutdownNow()
    running = false
    main.removeCallbacksAndMessages(null)
    ticker?.let { runCatching { windowManager.removeView(it.root) } }
    ticker = null
    queue.clear()
    pending.clear()
    super.onDestroy()
  }

  private fun startInForeground() {
    val manager = getSystemService(NotificationManager::class.java)
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Breaking news", NotificationManager.IMPORTANCE_MIN),
      )
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    val notification = builder
      .setContentTitle("Family Hub")
      .setContentText("Watching for household breaking news")
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .build()
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  // --- seen one-shot alerts (bounded, oldest first) ---

  private fun seenIds(): MutableList<String> {
    val raw = getSharedPreferences(TAG, MODE_PRIVATE).getString("seenList", "") ?: ""
    return if (raw.isEmpty()) mutableListOf() else raw.split('\n').toMutableList()
  }

  private fun markSeen(id: String) {
    val seen = seenIds()
    seen.remove(id)
    seen.add(id)
    while (seen.size > SEEN_LIMIT) seen.removeAt(0)
    getSharedPreferences(TAG, MODE_PRIVATE).edit().putString("seenList", seen.joinToString("\n")).apply()
  }

  // --- network ---

  private fun request(method: String, path: String, body: String?): String {
    val conn = URL("$apiUrl$path").openConnection() as HttpURLConnection
    conn.requestMethod = method
    conn.setRequestProperty("x-access-token", token)
    conn.connectTimeout = 10_000
    conn.readTimeout = 30_000
    if (body != null) {
      conn.doOutput = true
      conn.setRequestProperty("content-type", "application/json")
      conn.outputStream.use { it.write(body.toByteArray()) }
    }
    val text = (if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream)
      ?.bufferedReader()?.use { it.readText() } ?: ""
    if (conn.responseCode !in 200..299) {
      throw IllegalStateException("$method $path failed: HTTP ${conn.responseCode} $text")
    }
    return text
  }

  private fun parseAlert(o: JSONObject): Alert {
    val image = o.optString("image", "").takeIf { it.isNotEmpty() }?.let {
      runCatching {
        val bytes = Base64.decode(it, Base64.DEFAULT)
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
      }.getOrNull()
    }
    return Alert(
      id = o.getString("id"),
      group = o.optString("group", "").takeIf { it.isNotEmpty() },
      level = o.optString("level", "info"),
      text = o.getString("text"),
      sticky = o.optBoolean("sticky", false),
      secondsLeft = if (o.has("secondsLeft")) o.getLong("secondsLeft") else null,
      pause = o.optBoolean("pause", false),
      ack = o.optBoolean("ack", false),
      eventId = o.optString("eventId", "").takeIf { it.isNotEmpty() },
      image = image,
      caption = o.optString("caption", "").takeIf { it.isNotEmpty() },
    )
  }

  // The server's epoch changes when the household is reset; then everything shown so far is forgotten.
  private fun checkEpoch(epoch: String): Boolean {
    val prefs = getSharedPreferences(TAG, MODE_PRIVATE)
    val known = prefs.getString("epoch", null)
    if (known == epoch) return false
    prefs.edit().putString("epoch", epoch).putString("seenList", "").apply()
    return known != null
  }

  private fun poll() {
    try {
      val body = JSONObject(request("GET", "/alerts", null))
      val reset = checkEpoch(body.optString("epoch", "legacy"))
      val alerts = body.getJSONArray("alerts")
      val all = (0 until alerts.length()).map { parseAlert(alerts.getJSONObject(it)) }
      val seen = seenIds().toSet()
      val oneShots = all.filter { !it.sticky && it.id !in seen }
      val sticky = all.filter { it.sticky && it.group != null }
      lastError = null
      main.post {
        if (reset) {
          handled.clear()
          awaitingDeparture = null
        }
        awaitingDeparture?.let { group ->
          if (oneShots.any { it.group == group && it.id == "$group-done" }) {
            awaitingDeparture = null
            resumePlayback()
          }
        }
        wanted = LinkedHashMap<String, Alert>().also { map -> sticky.forEach { map[it.group!!] = it } }
        // The server moved on from a stage we handled locally: forget it.
        handled.retainAll(sticky.map { it.id }.toSet())
        oneShots.filter { pending.add(it.id) }.forEach { queue.add(it) }
        reconcile()
      }
    } catch (e: Exception) {
      lastError = e.message ?: e.toString()
      Log.e(TAG, "poll failed", e)
    }
  }

  private fun ackDeparture(eventId: String) {
    Thread {
      try {
        request("POST", "/alerts/ack", JSONObject().put("id", eventId).toString())
      } catch (e: Exception) {
        lastError = e.message ?: e.toString()
        Log.e(TAG, "ack failed", e)
      }
    }.start()
  }

  // --- what should be on screen (main thread) ---

  private fun reconcile() {
    val current = ticker
    val stickyWanted = wanted.values.firstOrNull { it.id !in handled }

    if (current != null && current.alert.sticky) {
      when {
        stickyWanted == null -> remove(current) { reconcile() }
        stickyWanted.id == current.alert.id -> current.deadline = deadlineFor(stickyWanted)
        stickyWanted.group == current.alert.group -> swap(current, stickyWanted)
        else -> remove(current) { reconcile() }
      }
      return
    }
    if (stickyWanted != null) {
      if (current != null) {
        // A one-shot is on screen; the countdown takes over in place.
        current.removal?.let { main.removeCallbacks(it) }
        pending.remove(current.alert.id)
        swap(current, stickyWanted)
      } else {
        showNew(stickyWanted)
      }
      return
    }
    if (current == null) {
      val next = queue.poll() ?: return
      showNew(next)
    }
  }

  private fun deadlineFor(alert: Alert): Long? =
    alert.secondsLeft?.let { SystemClock.elapsedRealtime() + it * 1000 }

  private fun showNew(alert: Alert) {
    try {
      val t = build(alert)
      windowManager.addView(t.root, layoutParams(alert))
      ticker = t
      try {
        enter(t)
      } catch (e: Exception) {
        windowManager.removeView(t.root)
        ticker = null
        throw e
      }
      if (!alert.sticky) markSeen(alert.id)
    } catch (e: Exception) {
      // Typically the overlay permission was not granted. The alert is tried again on the next poll.
      lastError = e.message ?: e.toString()
      Log.e(TAG, "overlay failed", e)
      pending.remove(alert.id)
    }
  }

  // Replaces the content of the window in place (a countdown stage changed, or took over a one-shot).
  private fun swap(current: Ticker, alert: Alert) {
    leaving(current)
    current.removal?.let { main.removeCallbacks(it) }
    current.countdown?.let { main.removeCallbacks(it) }
    try {
      windowManager.removeView(current.root)
    } catch (e: Exception) {
      Log.w(TAG, "removeView during swap", e)
    }
    ticker = null
    showNew(alert)
  }

  private fun remove(t: Ticker, then: () -> Unit) {
    leaving(t)
    t.removal?.let { main.removeCallbacks(it) }
    t.countdown?.let { main.removeCallbacks(it) }
    val sideWidth = t.side.layoutParams.width.toFloat()
    val bottomHeight = t.bottom.layoutParams.height.toFloat()
    t.bottom.animate().translationY(bottomHeight).setDuration(SLIDE_MS).start()
    t.side.animate().translationX(sideWidth).setDuration(SLIDE_MS).withEndAction {
      runCatching { windowManager.removeView(t.root) }
      if (ticker === t) ticker = null
      pending.remove(t.alert.id)
      then()
    }.start()
  }

  // An interrupt that paused playback is ending: the OK press, or the server moved on (the phone said
  // "I've left"). A timed-out interrupt leaves playback paused until the phone reports the departure.
  private fun leaving(t: Ticker) {
    if (!t.alert.pause) return
    if (t.resumeOnExit) resumePlayback() else awaitingDeparture = t.alert.group
  }

  // Runs the entrance, chime, countdown, pause and removal for a freshly added window.
  private fun enter(t: Ticker) {
    val alert = t.alert
    val sideWidth = t.side.layoutParams.width.toFloat()
    val bottomHeight = t.bottom.layoutParams.height.toFloat()
    t.bottom.translationY = bottomHeight
    t.side.translationX = sideWidth
    t.bottom.animate().translationY(0f).setDuration(SLIDE_MS).start()
    t.side.animate().translationX(0f).setDuration(SLIDE_MS).start()

    val chimes = when (alert.level) { "urgent" -> 2; "interrupt" -> 3; else -> 1 }
    chime(chimes)

    if (alert.pause) pausePlayback()

    t.deadline = deadlineFor(alert)
    if (alert.sticky && alert.level != "interrupt") {
      val tick = object : Runnable {
        override fun run() {
          val left = ((t.deadline ?: SystemClock.elapsedRealtime()) - SystemClock.elapsedRealtime()).coerceAtLeast(0) / 1000
          t.big.text = String.format(Locale.US, "%02d:%02d", left / 60, left % 60)
          t.small.text = if (left == 0L) "TIME TO GO" else "UNTIL DEPARTURE"
          main.postDelayed(this, 1000)
        }
      }
      t.countdown = tick
      tick.run()
    }

    if (alert.level == "interrupt") {
      t.root.isFocusable = true
      t.root.isFocusableInTouchMode = true
      t.root.setOnKeyListener { _, keyCode, event ->
        val ok = keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER ||
          keyCode == KeyEvent.KEYCODE_BUTTON_A || keyCode == KeyEvent.KEYCODE_BACK
        if (ok && event.action == KeyEvent.ACTION_UP) {
          alert.eventId?.let { ackDeparture(it) }
          handled.add(alert.id)
          remove(t) { reconcile() }
          true
        } else false
      }
      t.root.requestFocus()
      // Never keep the remote hostage: give up after a while and let the phone page finish the job.
      val timeout = Runnable {
        t.resumeOnExit = false
        handled.add(alert.id)
        remove(t) { reconcile() }
      }
      t.removal = timeout
      main.postDelayed(timeout, INTERRUPT_MAX_MS)
    } else if (!alert.sticky) {
      val duration = (MIN_SHOW_MS + alert.text.length * MS_PER_CHAR).coerceIn(MIN_SHOW_MS, MAX_SHOW_MS)
      val removal = Runnable { remove(t) { reconcile() } }
      t.removal = removal
      main.postDelayed(removal, duration)
    }
  }

  // Pauses whatever is playing: other apps through the media key, our own player through a broadcast.
  private fun pausePlayback() {
    try {
      val audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager
      // Our own player has no media session, so while our app is in front the media key cannot reach it.
      otherAppPaused = !appInForeground() && audio.isMusicActive
      audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PAUSE))
      audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_PAUSE))
    } catch (e: Exception) {
      Log.w(TAG, "media key pause failed", e)
    }
    try {
      sendBroadcast(Intent(ACTION_PAUSE).setPackage(packageName).putExtra("reason", "interrupt"))
    } catch (e: Exception) {
      Log.w(TAG, "pause broadcast failed", e)
    }
  }

  // Undoes pausePlayback. Our player resumes only if the interrupt paused it; another app gets the
  // play key only if something was playing there when the interrupt came.
  private fun resumePlayback() {
    if (otherAppPaused) {
      otherAppPaused = false
      try {
        val audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PLAY))
        audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_PLAY))
      } catch (e: Exception) {
        Log.w(TAG, "media key play failed", e)
      }
    }
    try {
      sendBroadcast(Intent(ACTION_RESUME).setPackage(packageName))
    } catch (e: Exception) {
      Log.w(TAG, "resume broadcast failed", e)
    }
  }

  private fun appInForeground(): Boolean {
    val info = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(info)
    return info.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
  }

  private fun chime(times: Int) {
    try {
      val tone = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80)
      for (i in 0 until times) {
        main.postDelayed({ tone.startTone(ToneGenerator.TONE_PROP_BEEP2, 350) }, i * 500L)
      }
      main.postDelayed({ tone.release() }, times * 500L + 600L)
    } catch (e: Exception) {
      // No audio is not a reason to drop the ticker.
      Log.w(TAG, "chime failed", e)
    }
  }

  // --- views ---

  private fun px(dp: Float) =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, dp, resources.displayMetrics)

  private fun text(value: String, sizeSp: Float, color: Int, bold: Boolean = false) =
    TextView(this).apply {
      text = value
      setTextColor(color)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
      if (bold) typeface = Typeface.DEFAULT_BOLD
    }

  private fun layoutParams(alert: Alert): WindowManager.LayoutParams {
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }
    var flags = WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
    // Only the interrupt stage takes the remote, to receive the OK press.
    if (alert.level != "interrupt") flags = flags or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
    return WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      type,
      flags,
      PixelFormat.TRANSLUCENT,
    )
  }

  private fun build(alert: Alert): Ticker {
    val metrics = resources.displayMetrics
    val width = metrics.widthPixels
    val height = metrics.heightPixels
    val bottomHeight = (height * 0.17).toInt()
    val sideWidth = (width * 0.19).toInt()
    val navy = Color.argb(235, 11, 31, 75)
    val red = Color.rgb(215, 20, 26)
    val darkRed = Color.argb(240, 120, 8, 12)
    val amber = Color.rgb(255, 170, 0)
    val green = Color.rgb(30, 160, 70)
    val white70 = Color.argb(200, 255, 255, 255)

    val bandColor = when (alert.level) { "urgent", "interrupt" -> darkRed; else -> navy }
    val labelColor = when (alert.level) { "developing" -> amber; "score" -> green; "urgent", "interrupt" -> Color.WHITE; else -> red }
    val labelTextColor = if (alert.level == "urgent" || alert.level == "interrupt") darkRed else Color.WHITE
    val labelText = when (alert.level) {
      "developing" -> "DEVELOPING"
      "urgent" -> "URGENT"
      "interrupt" -> "ALERT"
      "score" -> "GOAL!"
      else -> "BREAKING"
    }

    val root = FrameLayout(this)

    // Right side of the L: channel name, LIVE mark, and either the clock, a countdown, or a photo.
    val big = text(SimpleDateFormat("HH:mm", Locale.US).format(Date()), 40f, Color.WHITE, bold = true)
      .apply { setPadding(0, px(12f).toInt(), 0, 0) }
    val small = text(SimpleDateFormat("EEE, MMM d", Locale.US).format(Date()), 14f, white70)
    val side = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(bandColor)
      setPadding(px(18f).toInt(), px(24f).toInt(), px(18f).toInt(), px(18f).toInt())
      addView(text("FAMILY HUB NEWS", 13f, white70, bold = true))
      addView(text("● LIVE", 15f, if (bandColor == navy) red else Color.WHITE, bold = true).apply { setPadding(0, px(8f).toInt(), 0, 0) })
      if (alert.image != null) {
        addView(ImageView(this@BreakingNewsService).apply {
          setImageBitmap(alert.image)
          scaleType = ImageView.ScaleType.CENTER_CROP
          adjustViewBounds = true
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (sideWidth * 0.75).toInt()).apply { topMargin = px(14f).toInt() })
        big.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
      }
      addView(big)
      addView(small)
      alert.caption?.let { addView(text(it, 15f, Color.WHITE, bold = true).apply { setPadding(0, px(14f).toInt(), 0, 0) }) }
    }
    root.addView(side, FrameLayout.LayoutParams(sideWidth, height - bottomHeight, Gravity.TOP or Gravity.END))

    // Bottom of the L: the label and the headline.
    val label = text(labelText, 22f, labelTextColor, bold = true).apply {
      gravity = Gravity.CENTER
      background = GradientDrawable().apply { setColor(labelColor) }
      setPadding(px(22f).toInt(), 0, px(22f).toInt(), 0)
    }
    val headline = text(alert.text, 26f, Color.WHITE, bold = true).apply {
      gravity = Gravity.CENTER_VERTICAL
      setSingleLine(true)
      ellipsize = TextUtils.TruncateAt.MARQUEE
      marqueeRepeatLimit = -1
      isSelected = true
      setPadding(px(24f).toInt(), 0, px(24f).toInt(), 0)
    }
    val bottom = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      setBackgroundColor(bandColor)
      addView(label, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.MATCH_PARENT))
      addView(headline, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
      if (alert.level == "interrupt") {
        addView(text("PRESS OK", 18f, Color.WHITE, bold = true).apply {
          gravity = Gravity.CENTER
          setPadding(px(18f).toInt(), 0, px(24f).toInt(), 0)
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.MATCH_PARENT))
      }
    }
    root.addView(bottom, FrameLayout.LayoutParams(width, bottomHeight, Gravity.BOTTOM))

    return Ticker(alert, root, side, bottom, headline, label, big, small)
  }
}
