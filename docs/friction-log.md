# Friction log

Chronological notes of where development slowed down, what caused it, and what fixed it.

| When | What happened | Cause | Fix / time lost |
|---|---|---|---|
| Day 1 | `brew install --cask zulu@17` failed: the installer needs `sudo` and an interactive password. | Cask uses a pkg installer. | Used the `openjdk@17` formula instead (no sudo). ~10 min. |
| Day 1 | Android SDK licenses had to be accepted before `sdkmanager` would install packages. | Standard, but not mentioned in the sample README. | `yes \| sdkmanager --licenses`. ~5 min. |
| Day 1 | `yarn` not found even though the sample pins `packageManager: yarn@4.5.0`. | Corepack is not enabled by default on Homebrew Node. | `npm i -g corepack && corepack enable`. ~5 min. |
| Day 1 | `expo run:android --device emulator-5554` said "Could not find device with name". | The flag expects the AVD name, not the adb serial. | Ran without `--device`. ~5 min. |
| Day 1 | New Kotlin module compiled but `requireNativeModule('BreakingNews')` failed at runtime. | `expo-module.config.json` used `modulesClassNames` (older docs); autolinking produced `modules: []` without a warning. | Renamed the key to `modules`. ~60 min. |
| Day 1 | Overlay never appeared on the emulator. | No UI to grant `SYSTEM_ALERT_WINDOW` on TV builds. | `adb shell appops set com.familyhub.tv SYSTEM_ALERT_WINDOW allow`; the app now shows this command on screen. ~15 min. |
| Day 1 | Metro started with `CI=1` served a stale bundle after edits. | CI mode disables file watching. | Restart Metro without `CI`. ~15 min. |
| Day 1 | First OK press on the remote did nothing after dismissing the dev warning bar. | Unclear (possibly the emulator leaving touch mode). Not reproduced on the second press. | Noted; not fixed. |
| Day 1 | The sample's `.gitignore` ignored the hand-written `modules/breaking-news/android/`. | Bare `android/` pattern. | Scoped to `apps/*/android/`. ~10 min. |
| Day 1 | Hackathon rules require the demo video on "an actual Fire TV device or the Fire TV/Vega simulator", but Amazon ships no Fire OS simulator. | Documentation gap (see product feedback). | Demo will be recorded on a real Fire TV Stick. |
| Day 1 | Demo footage over YouTube would show third-party trademarks, which the rules forbid. | Rules. | Added a Play/Pause shortcut that plays a CC-licensed film inside the app for filming. |
| Day 2 | On the real Fire TV Stick 4K Max the debug app stayed on the splash screen. | The debug build loads JS from `localhost:8081` on the device and ignores the `expo-development-client` deep link. | `adb reverse tcp:8081 tcp:8081` works over wireless ADB too. ~10 min. |
| Day 2 | Would the overlay work on a real Fire TV at all? A forum answer says `SYSTEM_ALERT_WINDOW` is unsupported. | Conflicting information. | It works on Fire OS 8.1 after the `appops` grant, including taking the remote's OK press. No time lost, but a day of uncertainty. |
| Day 2 | After the interrupt was dismissed, the programme stayed paused. | Only a pause signal existed. | Added a resume signal (OK press, or the phone's "I've left", even after the 90-second timeout). ~40 min. |
