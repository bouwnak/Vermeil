import Foundation
import SwiftUI

struct ChatLine: Identifiable {
    let id = UUID()
    let fromYou: Bool
    let text: String
}

/// Everything the screens share: the pairing with the computer, the chat, the ears and her voice.
@MainActor
final class AppModel: ObservableObject {
    static let shared = AppModel()

    @Published private(set) var site: URL?
    @Published private(set) var name = "Vermeil"
    @Published private(set) var lines: [ChatLine] = []
    @Published private(set) var thinking = false
    @Published private(set) var speaking = false
    @Published var notice: String?

    @Published var wakeWord = UserDefaults.standard.string(forKey: "wakeWord") ?? "" {
        didSet { UserDefaults.standard.set(wakeWord, forKey: "wakeWord"); updateWakeWords() }
    }
    @Published var pcVoice = UserDefaults.standard.object(forKey: "pcVoice") as? Bool ?? true {
        didSet { UserDefaults.standard.set(pcVoice, forKey: "pcVoice") }
    }
    @Published var listenOnOpen = UserDefaults.standard.object(forKey: "listenOnOpen") as? Bool ?? true {
        didSet { UserDefaults.standard.set(listenOnOpen, forKey: "listenOnOpen") }
    }

    let listener = Listener()
    private let speaker = Speaker()
    private var pausedForWeb = false

    var api: VermeilAPI? {
        guard let site, let key = Keychain.get("key") else { return nil }
        return VermeilAPI(base: site, key: key)
    }

    var webLink: URL? {
        guard let site, let key = Keychain.get("key"),
              let encoded = key.addingPercentEncoding(withAllowedCharacters: .alphanumerics) else { return nil }
        return URL(string: site.absoluteString + "/#key=" + encoded)
    }

    private init() {
        site = UserDefaults.standard.url(forKey: "site")
        listener.onCommand = { [weak self] command in _ = await self?.ask(command, speak: true) }
        updateWakeWords()
    }

    // ---------- pairing ----------
    @discardableResult
    func pair(with text: String) -> Bool {
        guard let found = Pairing.parse(text) else { return false }
        Keychain.set(found.key, for: "key")
        UserDefaults.standard.set(found.url, forKey: "site")
        site = found.url
        notice = nil
        Task { await hello() }
        return true
    }

    func unpair() {
        listener.stop()
        Keychain.set(nil, for: "key")
        UserDefaults.standard.removeObject(forKey: "site")
        site = nil
        lines = []
    }

    func hello() async {
        guard let api else { return }
        do {
            let h = try await api.call("hello")
            name = h["name"] as? String ?? "Vermeil"
            updateWakeWords()
            notice = nil
        } catch {
            notice = error.localizedDescription
        }
    }

    private func updateWakeWords() {
        listener.wakeWords = WakeWord.words(custom: wakeWord, name: name)
    }

    // ---------- talking ----------
    @discardableResult
    func ask(_ text: String, speak: Bool) async -> String {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return "" }
        lines.append(ChatLine(fromYou: true, text: text))
        thinking = true
        defer { thinking = false }
        var reply: String
        do {
            guard let api else { throw VermeilAPI.Failure.badKey }
            let r = try await api.call("chat", ["text": text])
            reply = r["reply"] as? String ?? "Done."
            if let who = r["name"] as? String, who != name { name = who; updateWakeWords() }
        } catch {
            reply = error.localizedDescription
        }
        lines.append(ChatLine(fromYou: false, text: reply))
        if lines.count > 200 { lines.removeFirst(lines.count - 200) }
        if speak { await say(reply) }
        return reply
    }

    func say(_ text: String) async {
        speaking = true
        defer { speaking = false }
        if pcVoice, let api, let wav = try? await api.audio("speak", ["text": text]) {
            await speaker.play(wav)
        } else {
            await speaker.say(VermeilAPI.plain(text))
        }
    }

    func stopTalking() { speaker.stop() }

    // ---------- ears ----------
    func startListening() async {
        if let problem = await Listener.permissionProblem() {
            notice = problem
            return
        }
        do {
            try listener.start()
        } catch {
            notice = "Couldn't start the microphone: \(error.localizedDescription)"
        }
    }

    func stopListening() { listener.stop() }

    /// the full web app (Practice, Characters…) uses the mic itself, so the ears rest while it's open
    func webAppShown(_ shown: Bool) {
        if shown, listener.mode != .off {
            pausedForWeb = true
            listener.stop()
        } else if !shown, pausedForWeb {
            pausedForWeb = false
            Task { await startListening() }
        }
    }
}
