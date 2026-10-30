package com.vermeil.phone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** the same wake-word and pairing rules as the iPhone app (phone-ios/Checks) and ui/phone/phone.js */
class RulesTest {
    private val words = WakeWord.words("Mika", "Hiccup")

    @Test fun wakeWord() {
        assertEquals("what's the weather", WakeWord.find("Vermeil, what's the weather?", words))
        assertEquals("play music", WakeWord.find("hey vermeil play music", words))
        assertEquals("open notes", WakeWord.find("Vermeer open notes", words))
        assertEquals("", WakeWord.find("Hiccup", words))
        assertEquals("tell me a joke", WakeWord.find("ok Mika tell me a joke", words))
        assertNull(WakeWord.find("what's the weather", words))
        assertEquals("hey vermeil", words.first { it.contains("vermeil") })
    }

    @Test fun pairing() {
        val a = Pairing.parse("https://abc.trycloudflare.com/#key=s3cr%2Bet")
        assertEquals("https://abc.trycloudflare.com", a?.site)
        assertEquals("s3cr+et", a?.key)
        val b = Pairing.parse("vermeil://pair?u=http%3A%2F%2F100.64.1.2%3A8790&k=abc")
        assertEquals("http://100.64.1.2:8790", b?.site)
        assertEquals("abc", b?.key)
        assertNull(Pairing.parse("https://example.com/"))
        assertNull(Pairing.parse("vermeil://pair?u=ftp%3A%2F%2Fx&k=abc"))
        assertNull(Pairing.parse("not a link"))
    }

    @Test fun plainWords() {
        assertEquals("Hi there link", VermeilApi.plain("**Hi** _there_ [link](https://x.y)"))
    }
}
