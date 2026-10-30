import AppIntents

/// "Hey Siri, ask Vermeil" -> Siri asks what you want -> Vermeil on the computer answers -> Siri reads it out.
struct AskVermeil: AppIntent {
    static var title: LocalizedStringResource = "Ask Vermeil"
    static var description = IntentDescription("Ask Vermeil on your computer something and hear her answer.")

    @Parameter(title: "Question", requestValueDialog: "What do you want to ask?")
    var question: String

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let model = AppModel.shared
        guard model.api != nil else {
            return .result(value: "", dialog: "Open the Vermeil app and connect it to your computer first.")
        }
        let reply = VermeilAPI.plain(await model.ask(question, speak: false))
        return .result(value: reply, dialog: IntentDialog(stringLiteral: String(reply.prefix(600))))
    }
}

/// "Hey Siri, start Vermeil" -> opens the app and starts listening for the wake word again.
struct StartListening: AppIntent {
    static var title: LocalizedStringResource = "Start listening"
    static var description = IntentDescription("Open Vermeil and listen for her wake word.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        if AppModel.shared.listener.mode == .off { await AppModel.shared.startListening() }
        return .result()
    }
}

struct VermeilShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AskVermeil(), phrases: ["Ask \(.applicationName)", "Talk to \(.applicationName)", "Hey \(.applicationName)"],
                    shortTitle: "Ask Vermeil", systemImageName: "bubble.left.and.bubble.right")
        AppShortcut(intent: StartListening(), phrases: ["Start \(.applicationName)", "\(.applicationName) listen"],
                    shortTitle: "Start listening", systemImageName: "mic")
    }
}
