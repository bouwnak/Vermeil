package com.vermeil.phone

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.inputmethod.EditorInfo
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** The screens: connect to the computer, then Talk / Practice & more / Settings (built in code, no layout files). */
class MainActivity : Activity() {
    private val dp by lazy { resources.displayMetrics.density }
    private lateinit var root: LinearLayout
    private val content by lazy { FrameLayout(this) }
    private var tab = 0
    private var listenWhenAllowed = false
    private var commandWhenAllowed = false
    private var pausedForWeb = false

    // Talk screen parts, updated by refresh()
    private var orb: TextView? = null
    private var status: TextView? = null
    private var heard: TextView? = null
    private var note: TextView? = null
    private var chat: LinearLayout? = null
    private var chatScroll: ScrollView? = null
    private var shownLines = -1
    private var web: WebView? = null
    private val refresher = { refresh() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Hub.init(this)
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        setContentView(root)
        Hub.watch(refresher)
        handle(intent)
        build()
        if (Hub.site != null) {
            Hub.hello()
            if (Hub.listenOnOpen && !ListenService.running) startListening()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handle(intent)
        build()
    }

    override fun onDestroy() {
        Hub.unwatch(refresher)
        super.onDestroy()
    }

    /** vermeil://pair?u=…&k=… from the phone web page, or the assistant button (long-press home / power) */
    private fun handle(intent: Intent?) {
        val data = intent?.data
        if (data?.scheme == "vermeil") Hub.pair(data.toString())
        if (intent?.action == Intent.ACTION_ASSIST || intent?.action == Intent.ACTION_VOICE_COMMAND) {
            tab = 0
            if (Hub.site != null) startListening(commandNow = true)
        }
    }

    // ---------- permissions ----------
    private fun startListening(commandNow: Boolean = false) {
        val need = mutableListOf<String>()
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) need += Manifest.permission.RECORD_AUDIO
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            need += Manifest.permission.POST_NOTIFICATIONS
        if (need.isEmpty()) { ListenService.start(this, commandNow); return }
        listenWhenAllowed = true
        commandWhenAllowed = commandNow
        requestPermissions(need.toTypedArray(), 1)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, results)
        if (!listenWhenAllowed) return
        listenWhenAllowed = false
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            ListenService.start(this, commandWhenAllowed)
        } else {
            Hub.notice = "Vermeil needs the microphone to hear her name. Allow it in Settings → Apps → Vermeil → Permissions."
            refresh()
        }
    }

    // ---------- building the screens ----------
    private fun build() {
        root.removeAllViews()
        orb = null; status = null; heard = null; note = null; chat = null; chatScroll = null; shownLines = -1
        if (Hub.site == null) { root.addView(pairScreen(), LinearLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT)); return }
        root.addView(content, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
        val bar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        listOf("🎙 Talk", "📚 Practice & more", "⚙ Settings").forEachIndexed { i, label ->
            bar.addView(Button(this).apply {
                text = label
                isAllCaps = false
                setTypeface(null, if (i == tab) Typeface.BOLD else Typeface.NORMAL)
                setOnClickListener { show(i) }
            }, LinearLayout.LayoutParams(0, (56 * dp).toInt(), 1f))
        }
        root.addView(bar)
        show(tab)
    }

    private fun show(i: Int) {
        val wasWeb = tab == 1
        tab = i
        (root.getChildAt(1) as? LinearLayout)?.let { bar ->
            for (k in 0 until bar.childCount) (bar.getChildAt(k) as Button).setTypeface(null, if (k == i) Typeface.BOLD else Typeface.NORMAL)
        }
        content.removeAllViews()
        orb = null; shownLines = -1
        content.addView(when (i) { 0 -> talkScreen(); 1 -> webScreen(); else -> settingsScreen() })
        // the web app uses the microphone itself, so her ears rest while it's open
        if (i == 1 && ListenService.running) { pausedForWeb = true; ListenService.stop(this) }
        else if (wasWeb && i != 1 && pausedForWeb) { pausedForWeb = false; startListening() }
        refresh()
    }

    private fun text(s: CharSequence, size: Float = 16f, bold: Boolean = false) = TextView(this).apply {
        text = s
        textSize = size
        if (bold) setTypeface(null, Typeface.BOLD)
        setPadding(0, (6 * dp).toInt(), 0, (6 * dp).toInt())
    }

    private fun page(vararg views: View) = ScrollView(this).apply {
        addView(LinearLayout(this@MainActivity).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * dp).toInt()
            setPadding(p, p, p, p)
            views.forEach { addView(it) }
        })
    }

    private fun button(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        setOnClickListener { onClick() }
    }

    private fun pairScreen(): View {
        val link = EditText(this).apply {
            hint = "https://…/#key=…"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
        }
        val wrong = text("", 14f).apply { setTextColor(Color.rgb(220, 60, 60)) }
        return page(
            text("Vermeil", 28f, true),
            text("Connect to your computer", 18f, true),
            text("1. On your computer open Vermeil → Settings → 📱 Phone, turn it on and pick Tailscale (its address never changes) or Anywhere (Cloudflare)."),
            text("2. Scan the QR code with the phone's camera and open the page."),
            text("3. On that page tap Settings → 📲 Open in the Vermeil phone app."),
            text("Or paste the phone link", 18f, true),
            link,
            button("Paste the link") {
                val clip = getSystemService(ClipboardManager::class.java).primaryClip
                link.setText(clip?.getItemAt(0)?.coerceToText(this)?.toString().orEmpty())
            },
            button("Connect") {
                if (Hub.pair(link.text.toString())) build()
                else wrong.text = "That isn't a Vermeil phone link. Copy it with Copy link in Settings → 📱 Phone on the computer."
            },
            wrong,
        )
    }

    private fun talkScreen(): View {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding((12 * dp).toInt(), (16 * dp).toInt(), (12 * dp).toInt(), (8 * dp).toInt())
        }
        val size = (140 * dp).toInt()
        orb = TextView(this).apply {
            gravity = Gravity.CENTER
            textSize = 44f
            contentDescription = "Start or stop listening"
            setOnClickListener {
                when {
                    Hub.speaking -> Hub.stopTalking()
                    !ListenService.running -> startListening()
                    else -> ListenService.stop(this@MainActivity)
                }
            }
        }
        box.addView(orb, LinearLayout.LayoutParams(size, size))
        status = text("", 18f, true).apply { gravity = Gravity.CENTER }
        heard = text("", 14f).apply { gravity = Gravity.CENTER; alpha = 0.7f }
        note = text("", 13f).apply { gravity = Gravity.CENTER; setTextColor(Color.rgb(230, 140, 30)) }
        box.addView(status); box.addView(heard); box.addView(note)
        chat = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        chatScroll = ScrollView(this).apply { addView(chat) }
        box.addView(chatScroll, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
        val typed = EditText(this).apply {
            hint = "Type to ${Hub.name}…"
            imeOptions = EditorInfo.IME_ACTION_SEND
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        }
        val send = {
            val t = typed.text.toString()
            typed.setText("")
            Hub.ask(t, speak = false)
        }
        typed.setOnEditorActionListener { _, _, _ -> send(); true }
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        row.addView(typed, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        row.addView(button("Send") { send() })
        box.addView(row, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        return box
    }

    private fun webScreen(): View {
        val link = Hub.webLink ?: return text("Connect to your computer first.")
        val view = web ?: WebView(this).also { w ->
            w.settings.javaScriptEnabled = true
            w.settings.domStorageEnabled = true
            w.settings.mediaPlaybackRequiresUserGesture = false
            w.webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) {   // the web app's own mic buttons
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
                        request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                    else request.deny()
                }
            }
            w.loadUrl(link)
            web = w
        }
        (view.parent as? FrameLayout)?.removeView(view)
        return view
    }

    private fun settingsScreen(): View {
        val wake = EditText(this).apply {
            hint = "Vermeil"
            setText(Hub.wakeWord)
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun afterTextChanged(s: Editable?) { Hub.wakeWord = s.toString().trim() }
            })
        }
        val onOpen = CheckBox(this).apply {
            text = "Start listening when the app opens"
            isChecked = Hub.listenOnOpen
            setOnCheckedChangeListener { _, on -> Hub.listenOnOpen = on }
        }
        val pcVoice = CheckBox(this).apply {
            text = "Speak with her voice from the computer"
            isChecked = Hub.pcVoice
            setOnCheckedChangeListener { _, on -> Hub.pcVoice = on }
        }
        val check = text("", 13f).apply { setTextColor(Color.rgb(230, 140, 30)) }
        return page(
            text("Wake word", 18f, true),
            wake,
            text("“Vermeil”, “Hey Vermeil” and the active character's name always work too.", 13f),
            onOpen, pcVoice,
            text("Listening in the background", 18f, true),
            text("Lock the phone or switch apps - she keeps listening while the “Vermeil is listening” notification shows. Tap Stop there to end it."),
            text("Some phones close apps that run in the background. If she stops hearing you after a while, allow Vermeil to run without battery limits:"),
            button("Battery settings") { openSettings(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS) },
            text("Your phone's assistant button", 18f, true),
            text("Make Vermeil the phone's assistant: then long-pressing the home button (or the power button on some phones) asks her straight away. Pick Vermeil under Digital assistant app."),
            button("Choose the assistant app") { openSettings(Settings.ACTION_VOICE_INPUT_SETTINGS) },
            text("Computer", 18f, true),
            text(Hub.site ?: "-", 13f).apply { setTextIsSelectable(true) },
            button("Check the connection") { check.text = "Checking…"; Hub.hello() },
            check.also { checkNote = it },
            button("Disconnect this phone") {
                AlertDialog.Builder(this)
                    .setMessage("Disconnect? You'll need to scan the QR code again.")
                    .setPositiveButton("Disconnect") { _, _ -> ListenService.stop(this); web = null; Hub.unpair(); build() }
                    .setNegativeButton("Cancel", null)
                    .show()
            },
        )
    }

    private var checkNote: TextView? = null

    private fun openSettings(action: String) {
        try { startActivity(Intent(action)) } catch (e: Exception) {
            try { startActivity(Intent(Settings.ACTION_SETTINGS)) } catch (_: Exception) {}
        }
    }

    // ---------- keeping the Talk screen up to date ----------
    private fun refresh() {
        if (Hub.site == null && root.childCount > 0 && content.parent != null) { build(); return }
        checkNote?.let { if (tab == 2) it.text = Hub.notice ?: "Connected to ${Hub.name}." }
        val orb = orb ?: return
        val listening = ListenService.running
        val color = when {
            Hub.mode == Hub.Mode.COMMAND -> Color.rgb(236, 72, 153)
            listening -> Color.rgb(139, 92, 246)
            else -> Color.rgb(150, 150, 160)
        }
        orb.background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(color) }
        orb.text = if (listening) "🎙" else "🔇"
        status?.text = when {
            Hub.speaking -> "Speaking…  (tap to stop)"
            Hub.thinking -> "Thinking…"
            !listening -> "Not listening - tap the circle"
            Hub.mode == Hub.Mode.COMMAND -> "I'm listening…"
            Hub.mode == Hub.Mode.BUSY -> "One moment…"
            else -> "Say “${Hub.wakeWord.ifBlank { "Vermeil" }}” and what you want"
        }
        heard?.text = if (Hub.mode == Hub.Mode.COMMAND) Hub.heard else ""
        note?.text = Hub.notice.orEmpty()
        val chat = chat ?: return
        if (shownLines != Hub.lines.size) {
            chat.removeAllViews()
            Hub.lines.forEach { line ->
                chat.addView(text(line.text, 15f).apply {
                    gravity = if (line.fromYou) Gravity.END else Gravity.START
                    alpha = if (line.fromYou) 0.65f else 1f
                }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
            }
            shownLines = Hub.lines.size
            chatScroll?.post { chatScroll?.fullScroll(View.FOCUS_DOWN) }
        }
    }
}
