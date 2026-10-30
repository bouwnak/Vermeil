import AVFoundation
import AudioToolbox
import Speech

/// The recognition request the microphone feeds. The mic runs on its own audio thread, so this sits behind a lock.
final class MicFeed: @unchecked Sendable {
    private let lock = NSLock()
    private var request: SFSpeechAudioBufferRecognitionRequest?

    var current: SFSpeechAudioBufferRecognitionRequest? {
        lock.lock(); defer { lock.unlock() }
        return request
    }

    func set(_ new: SFSpeechAudioBufferRecognitionRequest?) {
        lock.lock(); request = new; lock.unlock()
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock(); let r = request; lock.unlock()
        r?.append(buffer)
    }
}

/// Always-on ears: the mic keeps running (also with the screen locked, thanks to the "audio" background mode),
/// the iPhone turns speech into text on the phone itself, and when the text has her wake word the words after it
/// go to `onCommand`. While she thinks and talks nothing is heard, so she doesn't answer herself.
@MainActor
final class Listener: ObservableObject {
    enum Mode { case off, waiting, command, busy }

    @Published private(set) var mode: Mode = .off
    @Published private(set) var heard = ""
    @Published var problem: String?
    var wakeWords = WakeWord.words(custom: "", name: nil)
    var onCommand: ((String) async -> Void)?

    private let engine = AVAudioEngine()
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let feed = MicFeed()
    private var task: SFSpeechRecognitionTask?
    private var wakeInThisRecognition = false       // false = the wake word came in an earlier one, so all of it is the command
    private var recycleTimer: Timer?, quietTimer: Timer?, giveUpTimer: Timer?
    private var observers: [NSObjectProtocol] = []

    /// nil when both are allowed, otherwise what to tell the user
    static func permissionProblem() async -> String? {
        let speech = await withCheckedContinuation { (c: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in
            SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0) }
        }
        if speech != .authorized {
            return "Vermeil needs Speech Recognition: open the Settings app → Vermeil → turn on Speech Recognition."
        }
        if !(await AVAudioApplication.requestRecordPermission()) {
            return "Vermeil needs the microphone: open the Settings app → Vermeil → turn on Microphone."
        }
        return nil
    }

    func start() throws {
        guard mode == .off else { return }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth,.mixWithOthers])
        try session.setActive(true)
        try startEngine()
        problem = nil
        mode = .waiting
        listenAgain()
        watch()
    }

    func stop() {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        observers = []
        quietTimer?.invalidate(); giveUpTimer?.invalidate()
        endRecognition()
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        mode = .off
        heard = ""
    }

    private func startEngine() throws {
        let input = engine.inputNode
        input.removeTap(onBus: 0)
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw NSError(domain: "Vermeil", code: 1, userInfo: [NSLocalizedDescriptionKey: "No microphone was found."])
        }
        let feed = self.feed
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in feed.append(buffer) }
        engine.prepare()
        try engine.start()
    }

    private func endRecognition() {
        recycleTimer?.invalidate()
        feed.current?.endAudio()
        feed.set(nil)
        task?.cancel()
        task = nil
    }

    /// back to waiting for the wake word, with a fresh recognition
    private func listenAgain() {
        quietTimer?.invalidate(); giveUpTimer?.invalidate()
        guard mode != .off else { return }
        mode = .waiting
        heard = ""
        newRecognition()
    }

    private func newRecognition() {
        endRecognition()
        wakeInThisRecognition = false
        guard let recognizer, recognizer.isAvailable else {
            problem = "Speech recognition isn't available right now. Trying again…"
            recycleTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: false) { [weak self] _ in
                Task { @MainActor in self?.newRecognition() }
            }
            return
        }
        problem = nil
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }   // private, no time limit
        feed.set(request)
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let ended = (result?.isFinal ?? false) || error != nil
            Task { @MainActor in self?.got(text, ended: ended, from: request) }
        }
        // a recognition stops by itself after about a minute, so start a fresh one before that
        recycleTimer = Timer.scheduledTimer(withTimeInterval: 50, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.recycle() }
        }
    }

    private func got(_ text: String?, ended: Bool, from request: SFSpeechAudioBufferRecognitionRequest) {
        guard request === feed.current, mode == .waiting || mode == .command else { return }
        if let text, !text.isEmpty {
            heard = text
            if mode == .waiting, WakeWord.find(in: text, words: wakeWords) != nil {
                mode = .command
                wakeInThisRecognition = true
                AudioServicesPlaySystemSound(1113)        // the "I'm listening" tone
                giveUpTimer = Timer.scheduledTimer(withTimeInterval: 8, repeats: false) { [weak self] _ in
                    Task { @MainActor in if self?.mode == .command { self?.listenAgain() } }
                }
            }
            if mode == .command {                       // when you've been quiet for a moment, the command is done
                quietTimer?.invalidate()
                quietTimer = Timer.scheduledTimer(withTimeInterval: 1.3, repeats: false) { [weak self] _ in
                    Task { @MainActor in self?.commandDone(ended: false) }
                }
            }
        }
        if ended {
            if mode == .command { commandDone(ended: true) } else { newRecognition() }
        }
    }

    private func commandDone(ended: Bool) {
        guard mode == .command else { return }
        let command = wakeInThisRecognition ? (WakeWord.find(in: heard, words: wakeWords) ?? "") : WakeWord.normalize(heard)
        if command.count > 2 {
            run(command)
        } else if ended {
            newRecognition()          // only the wake word so far: keep listening for the command (the 8 s timer still runs)
        }
    }

    private func run(_ command: String) {
        quietTimer?.invalidate(); giveUpTimer?.invalidate()
        endRecognition()
        mode = .busy
        Task {
            await onCommand?(command)
            if mode == .busy { listenAgain() }
        }
    }

    private func recycle() {
        switch mode {
        case .waiting: newRecognition()
        case .command:
            recycleTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: false) { [weak self] _ in
                Task { @MainActor in self?.recycle() }
            }
        default: break
        }
    }

    // phone calls, Siri, other apps taking the mic, headphones plugged in...
    private func watch() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            let ended = raw == AVAudioSession.InterruptionType.ended.rawValue
            Task { @MainActor in
                if ended { self?.restartEngine() } else { self?.endRecognition() }
            }
        })
        observers.append(center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.restartEngine() }
        })
        observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.mode != .off else { return }
                self.stop()
                try? self.start()
            }
        })
    }

    private func restartEngine() {
        guard mode != .off else { return }
        do {
            try AVAudioSession.sharedInstance().setActive(true)
            engine.stop()
            try startEngine()
            if mode != .busy { listenAgain() }
        } catch {
            problem = "The microphone stopped (\(error.localizedDescription)). Open Vermeil and tap Listen again."
        }
    }
}
