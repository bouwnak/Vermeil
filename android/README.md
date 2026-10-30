# Vermeil Android app

A real Android app that **keeps listening for her wake word, even with the screen off**, answers out loud in her
voice from your computer, and can be **your phone's assistant** (long-press the home / power button to ask her).
Practice, Characters and the rest of the phone web app are inside it too (the **Practice & more** tab).

Vermeil still runs on your computer. The app is the ears and the speaker, so **keep the computer on with
Vermeil open and Settings → 📱 Phone turned on**.

## Install it (about 5 minutes, no computer needed)
1. On your Android phone open this page in Chrome:
   **https://github.com/bouwnak/Vermeil/releases/tag/android-app**
2. Under **Assets** tap **Vermeil.apk** to download it.
3. Open the download (pull down the notifications, or Files → Downloads → Vermeil.apk).
4. Android asks to **allow installing from this source** → tap **Settings**, turn on **Allow from this source**, go back,
   and tap **Install**. (Google Play Protect may say it doesn't know the app: tap **More details → Install anyway**.
   It's your own app, built by GitHub from this folder.)
5. Open **Vermeil**.

Updating later: download the new **Vermeil.apk** from the same page and install it. If Android says the app
**isn't compatible / conflicts**, uninstall Vermeil first, then install the new one (you then connect it again).

## Connect it to your computer
1. On the computer: Vermeil → **Settings → 📱 Phone** → turn it on. Pick **Tailscale** if you can (install
   Tailscale on the computer and the phone, same account): its address never changes. **Anywhere (Cloudflare)**
   works too, but its address changes every time Vermeil starts, so you connect again then.
2. Scan the QR code with the phone's **camera** and open the page in Chrome.
3. On that page tap **Settings → 📲 Open in the Vermeil phone app**. Done.
   (Or copy the link with **Copy link** on the computer and paste it into the app.)
4. Allow the **Microphone** and **Notifications** when it asks.

## Using it
- Say **“Vermeil, what's the weather?”** (or “Hey Vermeil”, the active character's name, or your own wake word
  from the app's Settings). A beep means she heard her name; she answers out loud.
- Lock the phone: she keeps listening while the **“Vermeil is listening”** notification shows. Tap **Stop** there to end it.
- **Your assistant button:** app Settings → **Choose the assistant app** → **Digital assistant app** → Vermeil.
  Then long-press the home button (or the power button on some phones) and just say what you want.
- If she stops hearing you after a while, the phone is closing her to save battery: app Settings →
  **Battery settings** → Vermeil → **Don't optimise / Unrestricted**.

## Honest limits
- “Hey Google” itself can't be replaced by any app; the assistant button and her own wake word are the way.
- Listening uses the phone's speech recognition (the Google app). On Android 13+ it runs on the phone itself; on
  older phones it may need the internet, and some phones make a small sound each time listening restarts.
- Listening all the time uses battery. Plug in at night.
- Not on the Play Store (an app that always listens wouldn't be allowed); install it from the release page above.

## Build it yourself (optional)
GitHub builds it on every push that changes `android/` (`.github/workflows/android.yml`) and puts **Vermeil.apk** on the
release page. To build at home instead: install **Android Studio**, **File → Open** this `android` folder, wait for it
to finish loading, plug in the phone (with **USB debugging** on) and press **▶ Run**.

## For developers
- No libraries, only Android itself, so it builds with nothing extra.
- `ListenService.kt`: a foreground service (microphone type) with `SpeechRecognizer` in a loop (on-device on Android 13+), wake word → command (8 s to say it after the wake word alone).
- `WakeWord.kt`, `Pairing.kt`: the same rules as `ui/phone/phone.js` and the iPhone app; checked by `app/src/test/.../RulesTest.kt` (`gradle testDebugUnitTest`).
- `VermeilApi.kt`: `/api/hello|chat|speak` with `X-Vermeil-Key`. `Hub.kt`: shared state, her PC voice (WAV) or the phone's voice.
- `MainActivity.kt`: the screens (built in code), `vermeil://pair` links, and the assistant button (`ACTION_ASSIST`).
