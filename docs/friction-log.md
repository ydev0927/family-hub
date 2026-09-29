# Friction log

Where building Family Hub slowed down. Each entry: the task, the steps taken, what we expected versus
what happened, severity (High / Medium / Low), the workaround, and a suggestion.

## 1. Let the ticker draw over other apps on a Fire TV

- **Steps:** installed the app on a Fire TV Stick 4K Max (Fire OS 8.1) and looked for "Display over other apps" in Settings.
- **Expected:** a settings screen to grant the overlay permission, as on phones.
- **Actual:** there is no such screen; the overlay fails until `adb shell appops set <package> SYSTEM_ALERT_WINDOW allow` is run from a computer.
- **Severity:** High. A normal user cannot enable an overlay app without a computer.
- **Workaround:** the app shows the exact ADB command on the dashboard until the permission is granted, then starts the ticker by itself.
- **Suggestion:** add the toggle under Settings > Applications (or at least Developer options), and document it on the Fire TV developer site.

## 2. Find out whether overlays are supported on Fire TV at all

- **Steps:** searched the Fire TV docs and the developer forums before building the feature.
- **Expected:** a clear statement of overlay support per Fire OS version.
- **Actual:** no doc page; a forum answer from Amazon says overlays are unsupported. On a real Fire OS 8.1 device they work, including a focusable overlay that receives the remote's OK press.
- **Severity:** Medium. We nearly dropped the core feature.
- **Workaround:** built it and tested on the device.
- **Suggestion:** an official page on `TYPE_APPLICATION_OVERLAY` support and focus behaviour on each Fire OS version.

## 3. Find a Fire OS simulator for the demo video

- **Steps:** read the hackathon rule ("actual Fire TV device or the Fire TV/Vega simulator") and looked for a Fire OS simulator.
- **Expected:** an Amazon simulator that runs Fire OS apps.
- **Actual:** the only Amazon simulator is the Vega Virtual Device, which does not run Fire OS apps; the Fire TV docs no longer describe an emulator (the Fire App Builder page that pointed to the Android TV emulator returns 404).
- **Severity:** Medium.
- **Workaround:** developed on the Android TV emulator (API 31) and filmed on a real Fire TV Stick.
- **Suggestion:** state which emulator to use for Fire OS development and whether it counts for submissions.

## 4. Run a debug build on a real Fire TV over Wi-Fi

- **Steps:** `adb connect <ip>:5555`, installed the debug APK, launched it with the Expo dev-client deep link pointing at the Mac.
- **Expected:** the app loads its JavaScript from Metro on the Mac.
- **Actual:** the app stayed on the splash screen; the debug build looks for Metro at `localhost:8081` on the TV and ignored the deep link.
- **Severity:** Medium.
- **Workaround:** `adb reverse tcp:8081 tcp:8081` works over wireless ADB too. For the demo we built a standalone release APK.
- **Suggestion:** mention in the Fire TV ADB guide that `adb reverse` works over a network connection.

## 5. Keep a hand-written native module in git (react-native-multi-tv-app-sample)

- **Steps:** added `apps/expo-multi-tv/modules/breaking-news/android/` (Kotlin) and checked `git status`.
- **Expected:** the new files are tracked.
- **Actual:** the sample's `.gitignore` has a bare `android/`, which ignores every `android/` folder, including native modules.
- **Severity:** Low (caught before the first commit).
- **Workaround:** scoped the pattern to `apps/*/android/`.
- **Suggestion:** use `apps/*/android/` in the sample.

## 6. Register a Kotlin Expo module

- **Steps:** wrote `expo-module.config.json` with the key `modulesClassNames` (from older examples) and rebuilt.
- **Expected:** the module is found at runtime.
- **Actual:** autolinking silently produced `modules: []`; the app failed with `Cannot find native module 'BreakingNews'`.
- **Severity:** Medium (about an hour).
- **Workaround:** renamed the key to `modules`.
- **Suggestion:** warn on unknown keys in `expo-module.config.json`.

## 7. Redeem the hackathon's AWS credits on a new account

- **Steps:** created an AWS account and tried to plan for the $150 promotional credit.
- **Expected:** any new account can redeem it.
- **Actual:** the Free plan offered at sign-up is "not eligible for other promotional credits"; only the Paid plan can redeem them.
- **Severity:** Medium. Easy to miss, and a first-time user worries about bills on the Paid plan.
- **Workaround:** chose the Paid plan and added AWS Budgets alerts at $1 / $5 / $10 plus a budget action that attaches a deny-all policy at $10.
- **Suggestion:** say "choose the Paid plan" in the credit instructions, and offer a one-click "stop spending at $X" preset.

## 8. Call Amazon Nova on a brand-new AWS account

- **Steps:** `aws login`, then a Converse call to `us.amazon.nova-micro-v1:0`.
- **Expected:** works (Amazon's own models need no access request).
- **Actual:** `AccessDeniedException: Your account is currently being verified` for under an hour, while DynamoDB and Lambda already worked.
- **Severity:** Medium.
- **Workaround:** created the table and the function first, then tested Nova.
- **Suggestion:** mention account verification in the Bedrock getting-started page and show its status in the console.

## 9. Get reliable JSON and complete extraction from Nova

- **Steps:** asked for "JSON only" and gave Nova Lite a school notice with a field trip at the top and a bake sale at the bottom.
- **Expected:** plain JSON with both events.
- **Actual:** answers came wrapped in a ```` ```json ```` fence, and Nova Lite returned only the field trip, even when its own summary mentioned the bake sale.
- **Severity:** Medium.
- **Workaround:** parse the text between the first `{` and the last `}`; switched to Nova 2 Lite, which returned both events in every run.
- **Suggestion:** a JSON mode for Nova in the Converse API, and guidance on which Nova model to use for document extraction.

## 10. Write short, truthful news headlines

- **Steps:** asked Nova Micro and Nova 2 Lite (temperature 0.9) for a 14-word headline from a one-line fact.
- **Expected:** a dramatic wording of the same facts.
- **Actual:** invented details, e.g. "family meeting at noon" from "The Spinach in the kitchen should be used today", and "$120 worth of groceries" from a receipt summary.
- **Severity:** Medium. A family news ticker that lies is worse than none.
- **Workaround:** pass the concrete items added, forbid new facts in the prompt, temperature 0.4, and Nova Pro for headlines.
- **Suggestion:** document grounding tips for very short generations.

## 11. Record the demo on the Fire TV

- **Steps:** `adb shell screenrecord`, stopped with a signal.
- **Expected:** a playable video of the TV screen.
- **Actual:** stopping it early left an unplayable file, and a still screen produced a one-frame video (frames are written only on change).
- **Severity:** Low.
- **Workaround:** fixed `--time-limit` recordings, screenshots for still moments, conversion to a constant frame rate.
- **Suggestion:** a short "recording a demo on Fire TV" guide.

## 12. Show the demo at a chosen time of day

- **Steps:** shifted the server clock to film the 15:10 departure countdown in the evening.
- **Expected:** a consistent picture.
- **Actual:** the TV clocks showed the real time, and the countdown jumped back at each poll because the server rounded to minutes.
- **Severity:** Low (our own bugs, found while filming).
- **Workaround:** the server now returns its time, the TV clocks follow it, and the time left is exact to the second.
- **Suggestion:** none for Amazon; noted for completeness.
