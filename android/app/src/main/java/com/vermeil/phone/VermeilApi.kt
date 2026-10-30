package com.vermeil.phone

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Talks to Vermeil on the computer (brain/phone.py): POST /api/<name> with the X-Vermeil-Key header.
 *  Blocking - call it from a background thread. */
class VermeilApi(private val site: String, private val key: String) {
    class Failure(message: String) : Exception(message)

    companion object {
        const val BAD_KEY = "This phone isn't connected any more. Scan the QR code on your computer again."
        const val LOCKED = "Too many wrong keys. Wait a minute."
        const val OFFLINE = "I can't reach your computer. Is Vermeil open there with Phone turned on? " +
            "(The free Cloudflare link changes every time Vermeil starts - scan the QR code again, or use Tailscale.)"

        /** markdown -> plain words for speaking */
        fun plain(text: String): String = text
            .replace(Regex("```[\\s\\S]*?```"), " ")
            .replace(Regex("\\[([^\\]]*)\\]\\([^)]*\\)"), "$1")
            .replace(Regex("[*_`#>|]+"), "")
            .replace(Regex("\\s+"), " ").trim()
    }

    /** JSON in, JSON out ({"error": ...} becomes a Failure) */
    fun call(name: String, body: JSONObject = JSONObject()): JSONObject {
        val (_, data) = send(name, body)
        val obj = try { JSONObject(String(data, Charsets.UTF_8)) } catch (e: Exception) { JSONObject() }
        if (obj.has("error")) throw Failure(obj.optString("error"))
        return obj
    }

    /** her voice as a .wav (api "speak": the character's own PC voice) */
    fun audio(name: String, body: JSONObject): ByteArray {
        val (type, data) = send(name, body)
        if (!type.startsWith("audio/")) {
            val obj = try { JSONObject(String(data, Charsets.UTF_8)) } catch (e: Exception) { JSONObject() }
            throw Failure(obj.optString("error", "No voice came back."))
        }
        return data
    }

    private fun send(name: String, body: JSONObject): Pair<String, ByteArray> {
        val conn = try {
            (URL("$site/api/$name").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 15_000
                readTimeout = 120_000
                doOutput = true
                setRequestProperty("X-Vermeil-Key", key)
                setRequestProperty("Content-Type", "application/json")
            }
        } catch (e: IOException) { throw Failure(OFFLINE) }
        try {
            conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val data = stream?.use { it.readBytes() } ?: ByteArray(0)
            when (code) {
                200 -> return (conn.contentType ?: "") to data
                401, 403 -> throw Failure(BAD_KEY)
                429 -> throw Failure(LOCKED)
                502, 503, 504, 530 -> throw Failure(OFFLINE)       // the tunnel is up but the computer isn't answering
                else -> {
                    val obj = try { JSONObject(String(data, Charsets.UTF_8)) } catch (e: Exception) { JSONObject() }
                    throw Failure(obj.optString("error", "Your computer answered with error $code."))
                }
            }
        } catch (e: IOException) {
            throw Failure(OFFLINE)
        } finally {
            conn.disconnect()
        }
    }
}
