import SwiftUI

@main
struct VermeilApp: App {
    @StateObject private var model = AppModel.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .onOpenURL { url in model.pair(with: url.absoluteString) }   // vermeil://pair?... from the phone web page
        }
    }
}
