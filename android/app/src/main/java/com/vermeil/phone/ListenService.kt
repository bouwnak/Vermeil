package com.vermeil.phone

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/** Her ears: a foreground service (the notification with the microphone) that keeps listening for the wake word,
 *  also with the screen off. "Vermeil, what's the weather?" -> the computer answers -> she says it out loud. */
class ListenService : Service(), RecognitionListener {
    companion object {
        private const val STOP = "com.vermeil.phone.STOP"
        private const val NOW = "now"
        private const val CHANNEL = "listening"
        private const val COMMAND_WAIT_MS = 8_000L      // time to say the command after the wake word alone
        var running = false; private set

        /** commandNow: skip the wake word (the assistant button / the big circle) */
        fun start(context: Context, commandNow: Boolean = false) {
            val i = Intent(context, ListenService::class.java).putExtra(NOW, commandNow)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(i) else context.startService(i)
        }

        fun stop(context: Context) = context.stopService(Intent(context, ListenService::class.java))
    }

    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var commandUntil = 0L           // > now: the next thing heard is the command
    private var paused = false              // thinking or speaking - don't listen to herself
    private val tone by lazy { ToneGenerator(AudioManager.STREAM_NOTIFICATION, 60) }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Hub.init(this)
        val n = notification()
        if (Build.VERSION.SDK_INT >= 30) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        else startForeground(1, n)
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            Hub.notice = "This phone has no speech recognition. Install or update the Google app, then try again."
            Hub.changed()
            stopSelf()
            return
        }
        running = true
        makeRecognizer()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP) { stopSelf(); return START_NOT_STICKY }
        if (intent?.getBooleanExtra(NOW, false) == true) {
            Hub.stopTalking()
            paused = false
            commandUntil = System.currentTimeMillis() + COMMAND_WAIT_MS
            tone.startTone(ToneGenerator.TONE_PROP_BEEP, 120)
        }
        listen()
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        main.removeCallbacksAndMessages(null)
        recognizer?.destroy()
        recognizer = null
        Hub.mode = Hub.Mode.OFF
        Hub.heard = ""
        Hub.changed()
        super.onDestroy()
    }

    private fun makeRecognizer() {
        recognizer?.destroy()
        // Android 13+: the phone's own on-device recognizer (private, and it usually doesn't beep every time)
        recognizer = if (Build.VERSION.SDK_INT >= 33 && SpeechRecognizer.isOnDeviceRecognitionAvailable(this))
            SpeechRecognizer.createOnDeviceSpeechRecognizer(this)
        else SpeechRecognizer.createSpeechRecognizer(this)
        recognizer?.setRecognitionListener(this)
    }

    private fun listen() {
        if (!running || paused) return
        val now = System.currentTimeMillis() < commandUntil
        Hub.mode = if (now) Hub.Mode.COMMAND else Hub.Mode.WAITING
        Hub.changed()
        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1300L)
            .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
        try {
            recognizer?.cancel()
            recognizer?.startListening(i)
        } catch (e: Exception) {
            again(1000, fresh = true)
        }
    }

    private fun again(delay: Long, fresh: Boolean = false) {
        main.removeCallbacksAndMessages(null)
        main.postDelayed({ if (fresh) makeRecognizer(); listen() }, delay)
    }

    private fun heard(text: String) {
        if (System.currentTimeMillis() < commandUntil) { command(text); return }
        when (val after = WakeWord.find(text, Hub.wakeWords)) {
            null -> listen()
            "" -> {                                       // only her name: listen for what you want
                commandUntil = System.currentTimeMillis() + COMMAND_WAIT_MS
                tone.startTone(ToneGenerator.TONE_PROP_BEEP, 120)
                listen()
            }
            else -> command(after)
        }
    }

    private fun command(text: String) {
        commandUntil = 0
        if (text.isBlank()) { listen(); return }
        paused = true
        Hub.mode = Hub.Mode.BUSY
        Hub.heard = ""
        Hub.changed()
        tone.startTone(ToneGenerator.TONE_PROP_ACK, 120)
        Hub.ask(text, speak = true) { paused = false; listen() }
    }

    // ---------- RecognitionListener ----------
    override fun onResults(results: Bundle?) {
        val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
        if (text.isBlank()) listen() else heard(text)
    }

    override fun onPartialResults(partial: Bundle?) {
        val text = partial?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
        if (Hub.mode == Hub.Mode.COMMAND && text.isNotBlank()) { Hub.heard = text; Hub.changed() }
    }

    override fun onError(error: Int) {
        when (error) {
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> {
                Hub.notice = "Vermeil needs the microphone: allow it in the app's settings."
                stopSelf()
            }
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY, SpeechRecognizer.ERROR_CLIENT -> again(800, fresh = true)
            SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_SERVER -> again(3000)
            else -> again(250)                         // no match / silence: just listen again
        }
    }

    override fun onReadyForSpeech(params: Bundle?) {}
    override fun onBeginningOfSpeech() {}
    override fun onRmsChanged(rmsdB: Float) {}
    override fun onBufferReceived(buffer: ByteArray?) {}
    override fun onEndOfSpeech() {}
    override fun onEvent(eventType: Int, params: Bundle?) {}

    // ---------- the notification that keeps her listening ----------
    private fun notification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Listening for her name", NotificationManager.IMPORTANCE_LOW))
        }
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, ListenService::class.java).setAction(STOP), PendingIntent.FLAG_IMMUTABLE)
        val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else @Suppress("DEPRECATION") Notification.Builder(this)
        return b.setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("Vermeil is listening")
            .setContentText("Say “${Hub.wakeWord.ifBlank { "Vermeil" }}” and what you want")
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(null, "Stop", stop).build())
            .build()
    }
}
