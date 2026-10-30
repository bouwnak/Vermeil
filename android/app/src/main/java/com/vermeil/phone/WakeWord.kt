package com.vermeil.phone

/** Finds her wake word in what the phone heard and returns the words after it (the same rules as ui/phone/phone.js). */
object WakeWord {
    /** what speech recognition often writes when you say "Vermeil" */
    val soundsLike = mapOf(
        "vermeil" to listOf("vermeil", "vermail", "vermeille", "ver meil", "vermel", "vermeer", "for mail", "fair mail"),
    )

    /** your own wake word, "vermeil", and the active character's name - longest first, so "hey vermeil" wins over "vermeil" */
    fun words(custom: String, name: String?): List<String> {
        val all = mutableListOf(custom, "vermeil", "hey vermeil")
        if (!name.isNullOrBlank()) all += listOf(name, "hey $name")
        return all.map { normalize(it) }.filter { it.isNotEmpty() }.distinct().sortedByDescending { it.length }
    }

    /** lower case, only letters / digits / apostrophes, single spaces */
    fun normalize(text: String): String =
        text.lowercase().map { if (it.isLetterOrDigit() || it == '\'') it else ' ' }.joinToString("")
            .split(' ').filter { it.isNotEmpty() }.joinToString(" ")

    /** null = no wake word; "" = only the wake word; otherwise the command after it */
    fun find(heard: String, words: List<String>): String? {
        val text = " " + normalize(heard) + " "
        for (word in words) {
            for (variant in soundsLike[word] ?: listOf(word)) {
                val at = text.indexOf(" $variant ")
                if (at >= 0) return text.substring(at + variant.length + 2).trim()
            }
        }
        return null
    }
}
