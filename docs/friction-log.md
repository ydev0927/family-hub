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
| Day 2 | Every Bedrock call failed with "Your account is currently being verified" on the new AWS account. | New-account verification (under an hour for us). DynamoDB and Lambda worked meanwhile. | Built the table and function first, then tested Nova. ~45 min of waiting, no work lost. |
| Day 2 | Hackathon credits could only be redeemed on the Paid plan. | Free plan accounts are not eligible for promotional credits. | Chose Paid and added budget alerts plus an automatic stop at $10. ~20 min. |
| Day 2 | Nova Lite skipped the second event on a notice; headlines invented details ("family meeting at noon"). | Model capability and too little context in the prompt. | Nova 2 Lite for photos, Nova Pro for headlines, concrete facts, temperature 0.4. ~60 min. |
| Day 2 | Chore photos in the single household item could exceed DynamoDB's 400 KB limit. | 640 px photos, up to eight kept. | 400 px / JPEG 70% (~20 KB) and at most four photos. Caught before it failed. ~15 min. |
| Day 2 | Recording the demo on the Fire TV with `adb shell screenrecord`: stopping it with a signal left an unplayable file, and a still screen produced a one-frame video. | screenrecord only writes frames when the screen changes and needs a clean stop to finalize the file. | Fixed-length recordings (`--time-limit`), screenshots for still moments, then converted to constant frame rate for editing. ~20 min. |
| Day 2 | The departure countdown on the TV jumped back by up to a minute at each poll. | The server rounded the time left to whole minutes. | Seconds-precise `secondsLeft`. Spotted while filming. ~10 min. |
| Day 2 | With the household clock shifted for the demo, the TV clock still showed the real time. | Clocks on the TV used the device time. | The server now returns its time; the dashboard and the ticker follow it. ~30 min. |
