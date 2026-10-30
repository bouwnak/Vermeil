import Foundation

/// Finds her wake word in what the iPhone heard and returns the words after it (the same rules as ui/phone/phone.js).
enum WakeWord {
    /// what speech recognition often writes when you say "Vermeil"
    static let soundsLike: [String: [String]] = [
        "vermeil": ["vermeil", "vermail", "vermeille", "ver meil", "vermel", "vermeer", "for mail", "fair mail"],
    ]

    /// your own wake word, "vermeil", and the active character's name - longest first, so "hey vermeil" wins over "vermeil"
    static func words(custom: String, name: String?) -> [String] {
        var all = [custom, "vermeil", "hey vermeil"]
        if let name, !name.isEmpty { all += [name, "hey " + name] }
        var seen = Set<String>()
        return all.map { normalize($0) }.filter { !$0.isEmpty && seen.insert($0).inserted }.sorted { $0.count > $1.count }
    }

    /// lower case, only letters / digits / apostrophes, single spaces
    static func normalize(_ text: String) -> String {
        let keep = CharacterSet.letters.union(.decimalDigits).union(CharacterSet(charactersIn: "'"))
        let mapped = text.lowercased().unicodeScalars.map { keep.contains($0) ? Character($0) : " " }
        return String(mapped).split(separator: " ").joined(separator: " ")
    }

    /// nil = no wake word; "" = only the wake word; otherwise the command after it
    static func find(in heard: String, words: [String]) -> String? {
        let text = " " + normalize(heard) + " "
        for word in words {
            for variant in soundsLike[word] ?? [word] {
                if let range = text.range(of: " " + variant + " ") {
                    return String(text[range.upperBound...]).trimmingCharacters(in: .whitespaces)
                }
            }
        }
        return nil
    }
}
