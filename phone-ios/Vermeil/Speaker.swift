import AVFoundation

/// Plays her reply: the .wav in her PC voice, or the iPhone's own voice. `await` returns when she has finished talking.
@MainActor
final class Speaker: NSObject, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate {
    private var player: AVAudioPlayer?
    private let synth = AVSpeechSynthesizer()
    private var done: CheckedContinuation<Void, Never>?

    override init() {
        super.init()
        synth.delegate = self
    }

    func play(_ wav: Data) async {
        stop()
        guard let p = try? AVAudioPlayer(data: wav) else { return }
        player = p
        p.delegate = self
        await withCheckedContinuation { c in
            done = c
            if !p.play() { finish() }
        }
    }

    func say(_ text: String) async {
        stop()
        let line = AVSpeechUtterance(string: text)
        line.voice = AVSpeechSynthesisVoice(language: "en-US")
        await withCheckedContinuation { c in
            done = c
            synth.speak(line)
        }
    }

    func stop() {
        player?.stop()
        player = nil
        if synth.isSpeaking { synth.stopSpeaking(at: .immediate) }
        finish()
    }

    private func finish() {
        let c = done
        done = nil
        c?.resume()
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in self.finish() }
    }

    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        Task { @MainActor in self.finish() }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.finish() }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in self.finish() }
    }
}
