package com.vermeil.phone

import java.net.URI
import java.net.URLDecoder

/** The link from the computer: the normal phone link (https://…/#key=…) or the app link (vermeil://pair?u=…&k=…). */
object Pairing {
    data class Found(val site: String, val key: String)

    fun parse(text: String): Found? {
        val uri = try { URI(text.trim()) } catch (e: Exception) { return null }
        if (uri.scheme.equals("vermeil", ignoreCase = true)) {
            val query = (uri.rawQuery ?: return null).split('&').mapNotNull {
                val i = it.indexOf('=')
                if (i <= 0) null else it.substring(0, i) to decode(it.substring(i + 1))
            }.toMap()
            val key = query["k"]?.takeIf { it.isNotEmpty() } ?: return null
            val site = siteOf(query["u"] ?: return null) ?: return null
            return Found(site, key)
        }
        val fragment = uri.rawFragment ?: return null
        if (!fragment.startsWith("key=")) return null
        val key = decode(fragment.substring(4)).takeIf { it.isNotEmpty() } ?: return null
        return Found(siteOf(text.trim()) ?: return null, key)
    }

    /** only the scheme, host and port - the app adds /api/... itself */
    fun siteOf(text: String): String? {
        val uri = try { URI(text.trim()) } catch (e: Exception) { return null }
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        val host = uri.host?.takeIf { it.isNotEmpty() } ?: return null
        return "$scheme://$host" + (if (uri.port > 0) ":${uri.port}" else "")
    }

    private fun decode(s: String) = try { URLDecoder.decode(s, "UTF-8") } catch (e: Exception) { s }
}
