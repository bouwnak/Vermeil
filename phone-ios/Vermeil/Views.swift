import SwiftUI
import UIKit
import WebKit

struct RootView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        if model.site == nil {
            PairView()
        } else {
            MainTabs()
        }
    }
}

// ---------- first start: connect to the computer ----------
struct PairView: View {
    @EnvironmentObject var model: AppModel
    @State private var link = ""
    @State private var wrong = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("1. On your computer open Vermeil → **Settings → 📱 Phone**, turn it on and pick **Tailscale** (its address never changes) or **Anywhere (Cloudflare)**.")
                    Text("2. Scan the QR code with the iPhone **Camera** app and open the page.")
                    Text("3. On that page tap **Settings → 📲 Open in the Vermeil phone app**.")
                } header: { Text("Connect to your computer") }
                Section {
                    TextField("https://…/#key=…", text: $link, axis: .vertical)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button("Paste the link") { link = UIPasteboard.general.string ?? "" }
                    Button("Connect") { wrong = !model.pair(with: link) }
                        .bold()
                        .disabled(link.isEmpty)
                } header: { Text("Or paste the phone link") } footer: {
                    if wrong { Text("That isn't a Vermeil phone link. Copy it with **Copy link** in Settings → 📱 Phone.").foregroundStyle(.red) }
                }
            }
            .navigationTitle("Vermeil")
        }
    }
}

// ---------- the app ----------
struct MainTabs: View {
    @EnvironmentObject var model: AppModel
    @State private var tab = 0

    var body: some View {
        TabView(selection: $tab) {
            TalkView().tabItem { Label("Talk", systemImage: "waveform") }.tag(0)
            WebAppView().tabItem { Label("Practice & more", systemImage: "square.grid.2x2") }.tag(1)
            SettingsView().tabItem { Label("Settings", systemImage: "gearshape") }.tag(2)
        }
        .onChange(of: tab) { _, now in model.webAppShown(now == 1) }
        .task {
            await model.hello()
            if model.listenOnOpen, model.listener.mode == .off { await model.startListening() }
        }
    }
}

struct TalkView: View {
    @EnvironmentObject var model: AppModel
    @ObservedObject var listener = AppModel.shared.listener
    @State private var typed = ""

    private var status: String {
        if model.speaking { return "Speaking…" }
        if model.thinking { return "Thinking…" }
        switch listener.mode {
        case .off: return "Not listening"
        case .waiting: return "Say “\(model.wakeWord.isEmpty ? "Vermeil" : model.wakeWord)” and what you want"
        case .command: return "I'm listening…"
        case .busy: return "One moment…"
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Button {
                    if model.speaking { model.stopTalking() }
                    else if listener.mode == .off { Task { await model.startListening() } }
                    else { model.stopListening() }
                } label: {
                    Circle()
                        .fill(listener.mode == .command ? Color.pink : listener.mode == .off ? Color.gray.opacity(0.4) : Color.purple)
                        .frame(width: 140, height: 140)
                        .overlay(Image(systemName: listener.mode == .off ? "mic.slash.fill" : "mic.fill")
                            .font(.system(size: 48)).foregroundStyle(.white))
                        .scaleEffect(model.speaking || listener.mode == .command ? 1.08 : 1)
                        .animation(.easeInOut(duration: 0.6).repeatForever(), value: model.speaking || listener.mode == .command)
                }
                .accessibilityLabel(listener.mode == .off ? "Start listening" : "Stop listening")
                Text(status).font(.headline).multilineTextAlignment(.center)
                if !listener.heard.isEmpty, listener.mode == .command {
                    Text(listener.heard).font(.callout).foregroundStyle(.secondary).lineLimit(2)
                }
                if let note = model.notice ?? listener.problem {
                    Text(note).font(.footnote).foregroundStyle(.orange).multilineTextAlignment(.center)
                }
                ScrollViewReader { scroll in
                    List(model.lines) { line in
                        Text(line.text)
                            .frame(maxWidth: .infinity, alignment: line.fromYou ? .trailing : .leading)
                            .foregroundStyle(line.fromYou ? .secondary : .primary)
                            .id(line.id)
                    }
                    .listStyle(.plain)
                    .onChange(of: model.lines.count) { _, _ in
                        if let last = model.lines.last { withAnimation { scroll.scrollTo(last.id, anchor: .bottom) } }
                    }
                }
                HStack {
                    TextField("Type to \(model.name)…", text: $typed)
                        .textFieldStyle(.roundedBorder)
                        .submitLabel(.send)
                        .onSubmit(send)
                    Button("Send", action: send).disabled(typed.isEmpty)
                }
                .padding(.horizontal)
                .padding(.bottom, 8)
            }
            .padding(.top)
            .navigationTitle(model.name)
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func send() {
        let text = typed
        typed = ""
        Task { await model.ask(text, speak: false) }
    }
}

/// The full phone web app (Practice, Characters, Chat…) from the computer, inside the app.
struct WebAppView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        if let link = model.webLink {
            WebView(url: link).ignoresSafeArea(edges: .top)
        } else {
            Text("Connect to your computer first.")
        }
    }
}

struct WebView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let view = WKWebView(frame: .zero, configuration: config)
        view.load(URLRequest(url: url))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}
}

struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    @State private var confirmForget = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Vermeil", text: $model.wakeWord)
                        .textInputAutocapitalization(.never)
                    Toggle("Start listening when the app opens", isOn: $model.listenOnOpen)
                    Toggle("Speak with her voice from the computer", isOn: $model.pcVoice)
                } header: { Text("Wake word") } footer: {
                    Text("“Vermeil”, “Hey Vermeil” and the active character's name always work too.")
                }
                Section {
                    Text("Lock the phone or switch apps - she keeps listening while the **orange dot** shows at the top. Swiping Vermeil away in the app switcher stops her; open the app (or say “Hey Siri, start Vermeil”) to start again.")
                    Text("Listening uses the battery (about as much as a call). Plug in at night.")
                } header: { Text("Listening in the background") }
                Section {
                    Text("Say **“Hey Siri, ask Vermeil”** - Siri asks what you want and reads her answer, even from the lock screen. **“Hey Siri, start Vermeil”** opens the app and starts listening.")
                } header: { Text("Siri") }
                Section {
                    Text(model.site?.absoluteString ?? "-").font(.footnote).textSelection(.enabled)
                    Button("Check the connection") { Task { await model.hello() } }
                    if let note = model.notice { Text(note).font(.footnote).foregroundStyle(.orange) }
                    Button("Disconnect this iPhone", role: .destructive) { confirmForget = true }
                } header: { Text("Computer") }
            }
            .navigationTitle("Settings")
            .confirmationDialog("Disconnect? You'll need to scan the QR code again.", isPresented: $confirmForget, titleVisibility: .visible) {
                Button("Disconnect", role: .destructive) { model.unpair() }
            }
        }
    }
}
