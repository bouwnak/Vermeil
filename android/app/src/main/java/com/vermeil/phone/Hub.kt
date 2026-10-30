package com.vermeil.phone

import android.content.Context
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import org.json.JSONObject
import java.io.File
import java.net.URLEncoder
import java.util.concurrent.Executors

/** Everything the screens and the listening service share: the pairing, the chat, the ears' state and her voice. */
object Hub {
    enum class Mode { OFF, WAITING, COMMAND, BUSY }
    data class Line(val fromYou: Boolean, val text: String)

    private lateinit var app: Context
    private val prefs by lazy { app.getSharedPreferences("vermeil", Context.MODE_PRIVATE) }   // only this app can read it
    private val main = Handler(Looper.getMainLooper())
    private val work = Executors.newSingleThreadExecutor()
    private val watchers = mutableListOf<() -> Unit>()

    var name = "Vermeil"; private set
    val lines = mutableListOf<Line>()
    var thinking = false; private set
    var speaking = false; private set
    var notice: String? = null
    var mode = Mode.OFF
    var heard = ""

    fun init(context: Context) {
        if (::app.isInitialized) return
        app = context.applicationContext
        name = prefs.getString("name", "Vermeil") ?: "Vermeil"
    }

    // ---------- settings ----------
    val site: String? get() = prefs.getString("site", null)
    private val key: String? get() = prefs.getString("key", null)
    var wakeWord: String
        get() = prefs.getString("wakeWord", "") ?: ""
        set(v) = prefs.edit().putString("wakeWord", v).apply()
    var pcVoice: Boolean
        get() = prefs.getBoolean("pcVoice", true)
        set(v) = prefs.edit().putBoolean("pcVoice", v).apply()
    var listenOnOpen: Boolean
        get() = prefs.getBoolean("listenOnOpen", true)
        set(v) = prefs.edit().putBoolean("listenOnOpen", v).apply()

    val wakeWords: List<String> get() = WakeWord.words(wakeWord, name)

    val api: VermeilApi?
        get() {
            val s = site ?: return null
            val k = key ?: return null
            return VermeilApi(s, k)
        }

    /** the full phone web app (Practice, Characters…) from the computer */
    val webLink: String?
        get() {
            val s = site ?: return null
            val k = key ?: return null
            return "$s/#key=" + URLEncoder.encode(k, "UTF-8")
        }

    fun watch(fn: () -> Unit) { watchers += fn }
    fun unwatch(fn: () -> Unit) { watchers -= fn }
    fun changed() = main.post { watchers.toList().forEach { it() } }

    // ---------- pairing ----------
    fun pair(text: String): Boolean {
        val found = Pairing.parse(text) ?: return false
        prefs.edit().putString("site", found.site).putString("key", found.key).apply()
        notice = null
        changed()
        hello()
        return true
    }

    fun unpair() {
        prefs.edit().remove("site").remove("key").apply()
        lines.clear()
        changed()
    }

    fun hello() = work.execute {
        val api = api ?: return@execute
        try {
            setName(api.call("hello").optString("name", "Vermeil"))
            notice = null
        } catch (e: Exception) {
            notice = e.message
        }
        changed()
    }

    private fun setName(who: String) {
        if (who.isBlank() || who == name) return
        name = who
        prefs.edit().putString("name", who).apply()
    }

    // ---------- talking ----------
    /** sends what you said to the computer; done(reply) runs on the main thread after she has spoken */
    fun ask(text: String, speak: Boolean, done: ((String) -> Unit)? = null) {
        val said = text.trim()
        if (said.isEmpty()) { done?.let { main.post { it("") } }; return }
        lines += Line(true, said)
        thinking = true
        changed()
        work.execute {
            val reply = try {
                val r = (api ?: throw VermeilApi.Failure(VermeilApi.BAD_KEY)).call("chat", JSONObject().put("text", said))
                setName(r.optString("name", name))
                r.optString("reply", "Done.")
            } catch (e: Exception) {
                e.message ?: "Something went wrong."
            }
            thinking = false
            lines += Line(false, reply)
            while (lines.size > 200) lines.removeAt(0)
            changed()
            if (speak) say(reply) { done?.invoke(reply) } else main.post { done?.invoke(reply) }
        }
    }

    // ---------- her voice ----------
    private var tts: TextToSpeech? = null
    private var player: MediaPlayer? = null
    private var afterSpeaking: (() -> Unit)? = null

    /** her own PC voice when "Speak with her voice from the computer" is on, else the phone's voice. Call off the main thread. */
    fun say(text: String, done: () -> Unit) {
        speaking = true
        changed()
        val wav = if (pcVoice) try { api?.audio("speak", JSONObject().put("text", text)) } catch (e: Exception) { null } else null
        main.post {
            afterSpeaking = { speaking = false; changed(); done() }
            if (wav != null) playWav(wav) else phoneVoice(VermeilApi.plain(text))
        }
    }

    private fun finished() = main.post { afterSpeaking?.also { afterSpeaking = null }?.invoke() }

    private fun playWav(wav: ByteArray) {
        val file = File(app.cacheDir, "reply.wav").apply { writeBytes(wav) }
        try {
            player?.release()
            player = MediaPlayer().apply {
                setDataSource(file.path)
                setOnCompletionListener { finished() }
                setOnErrorListener { _, _, _ -> finished(); true }
                prepare()
                start()
            }
        } catch (e: Exception) {
            finished()
        }
    }

    private fun phoneVoice(text: String) {
        val ready = tts
        if (ready != null) { ready.speak(text, TextToSpeech.QUEUE_FLUSH, null, "reply"); return }
        tts = TextToSpeech(app) { status ->
            if (status != TextToSpeech.SUCCESS) { finished(); return@TextToSpeech }
            tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(id: String?) {}
                override fun onDone(id: String?) = finished()
                @Deprecated("old Android") override fun onError(id: String?) = finished()
            })
            tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "reply")
        }
    }

    fun stopTalking() {
        player?.let { try { it.stop() } catch (e: Exception) {} }
        tts?.stop()
        finished()
    }
}
