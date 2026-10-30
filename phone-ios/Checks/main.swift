// Quick checks of the wake word and pairing rules (no iPhone needed). On a Mac, in phone-ios:
//   swiftc Vermeil/WakeWord.swift Vermeil/Pairing.swift Checks/main.swift -o /tmp/checks && /tmp/checks
import Foundation

var failed = 0
func check(_ ok: Bool, _ what: String) {
    if !ok { failed += 1; print("FAIL: \(what)") }
}

let words = WakeWord.words(custom: "", name: "Pip")
check(words.first == "hey vermeil", "longest wake word first")
check(WakeWord.find(in: "Vermeil, what's the weather?", words: words) == "what's the weather", "command after the wake word")
check(WakeWord.find(in: "hey Vermeer play some music", words: words) == "play some music", "sound-alike")
check(WakeWord.find(in: "Vermeil", words: words) == "", "only the wake word")
check(WakeWord.find(in: "the weather is nice", words: words) == nil, "no wake word")
check(WakeWord.find(in: "pip open the gym", words: words) == "open the gym", "character name")
check(WakeWord.find(in: "vermeilish", words: words) == nil, "whole words only")
check(WakeWord.words(custom: "Hey Buddy!", name: nil).contains("hey buddy"), "custom wake word")

let web = Pairing.parse("https://abc-def.trycloudflare.com/#key=Ab_c-1")
check(web?.url.absoluteString == "https://abc-def.trycloudflare.com" && web?.key == "Ab_c-1", "web link")
let app = Pairing.parse("vermeil://pair?u=https%3A%2F%2Fpc.tail1.ts.net&k=xyz")
check(app?.url.absoluteString == "https://pc.tail1.ts.net" && app?.key == "xyz", "app link")
check(Pairing.parse("http://192.168.1.5:8790/#key=k")?.url.absoluteString == "http://192.168.1.5:8790", "local link with port")
check(Pairing.parse("https://example.com/") == nil, "no key")
check(Pairing.parse("vermeil://pair?u=javascript:alert(1)&k=x") == nil, "only http/https")
check(Pairing.parse("ftp://x/#key=k") == nil, "ftp refused")

print(failed == 0 ? "All checks passed" : "\(failed) check(s) failed")
exit(failed == 0 ? 0 : 1)
