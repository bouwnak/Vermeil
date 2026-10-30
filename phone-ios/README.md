# Vermeil iPhone app

A real iPhone app that **keeps listening for her wake word with the phone locked**, answers out loud in her
voice from your computer, and works with **“Hey Siri, ask Vermeil”**. Practice, Characters and the rest of
the phone web app are inside it too (the **Practice & more** tab).

Vermeil still runs on your computer. The app is the ears and the speaker, so **keep the computer on with
Vermeil open and Settings → 📱 Phone turned on**.

## What you need
- **A Mac with Xcode** (free from the Mac App Store). Windows can't build iPhone apps. Borrowing a Mac works:
  once the app is on your iPhone, you only need the Mac again to renew it.
- An iPhone with iOS 17 or newer, and its USB cable.
- Your Apple ID. A free one works, but the app stops opening after **7 days** and must be installed again
  from the Mac. A paid Apple Developer account ($99/year) makes that 1 year.

## Install it (about 15 minutes the first time)
1. Copy the whole Vermeil folder to the Mac (or `git clone` it there).
2. On the Mac, open **Terminal** and install the project maker (needs [Homebrew](https://brew.sh)):
   ```bash
   brew install xcodegen
   ```
3. Go into this folder and make the Xcode project:
   ```bash
   cd path/to/Vermeil/phone-ios
   xcodegen
   open Vermeil.xcodeproj
   ```
4. In Xcode, click **Vermeil** at the top of the left list → **Signing & Capabilities** → **Team**: pick your
   Apple ID (**Add an Account…** the first time). If it says the bundle identifier is taken, change
   `com.vermeil.phone` to something like `com.yourname.vermeil`.
5. Plug in the iPhone, unlock it, and tap **Trust**. Pick your iPhone at the top of Xcode and press **▶ Run**.
6. The first time, the iPhone says "Untrusted Developer": open the **Settings** app → **General** →
   **VPN & Device Management** → your Apple ID → **Trust**. Also turn on **Developer Mode** if it asks
   (Settings → Privacy & Security → Developer Mode, then restart).

## Connect it to your computer
1. On the computer: Vermeil → **Settings → 📱 Phone** → turn it on. Pick **Tailscale** if you can (install
   Tailscale on the computer and the iPhone, same account): its address never changes. **Anywhere (Cloudflare)**
   works too, but its address changes every time Vermeil starts, so you scan again then.
2. Scan the QR code with the iPhone **Camera** app and open the page.
3. On that page tap **Settings → 📲 Open in the Vermeil phone app**. Done.
   (Or copy the link with **Copy link** on the computer and paste it into the app.)
4. Allow the **Microphone** and **Speech Recognition** when it asks.

## Using it
- Say **“Vermeil, what's the weather?”** (or “Hey Vermeil”, the active character's name, or your own wake word
  from the app's Settings). A tone means she heard her name; she answers out loud.
- Lock the phone: she keeps listening while the **orange dot** shows. Swiping the app away stops her - say
  **“Hey Siri, start Vermeil”** or open the app to start again.
- **“Hey Siri, ask Vermeil”** works from the lock screen even when the app isn't listening.

## Honest limits
- Apple doesn't let any app replace Siri or the side button. “Hey Siri, ask Vermeil” is the closest.
- An app that listens all the time isn't allowed on the App Store, so this is for your own iPhone only.
- Listening uses battery (roughly like a phone call). Phone calls and other apps that use the mic pause
  her; she starts again after.
- Speech is turned into text on the iPhone itself (private, no time limit) on iPhone XS and newer; older
  iPhones send it to Apple.

## For developers
- `Vermeil/Listener.swift` - always-on mic (`AVAudioEngine`, "audio" background mode) + on-device
  `SFSpeechRecognizer`, wake word → command after 1.3 s of quiet.
- `Vermeil/WakeWord.swift`, `Pairing.swift` - the same rules as `ui/phone/phone.js`; checked by
  `Checks/main.swift` (`swiftc Vermeil/WakeWord.swift Vermeil/Pairing.swift Checks/main.swift -o /tmp/c && /tmp/c`).
- `Vermeil/SiriIntents.swift` - App Intents for Siri. `VermeilAPI.swift` - `/api/hello|chat|speak` with `X-Vermeil-Key`.
- GitHub builds it on every push that changes `phone-ios/` (`.github/workflows/ios.yml`).
