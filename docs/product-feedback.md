# Product feedback (tools, APIs and SDKs used)

Feedback from building Family Hub, per tool: what we used it for, what worked, what needs work,
how getting started felt, and whether we would use it again. Details for each tool follow the table.

| Tool | Used for | Worked well | Needs improvement | Onboarding | Use again? |
|---|---|---|---|---|---|
| react-native-multi-tv-app-sample | Starting point for the TV app | Fire OS build, remote keys and focus handling out of the box | Fire-OS-only quick start; `.gitignore` hides native modules | Fast: running on the emulator within an hour | Yes, as the base for any Fire OS app |
| Expo modules on react-native-tvos | Kotlin overlay service and its bridge | `Module`/`Events` API; events worked first time | Warn on unknown keys in `expo-module.config.json` | One silent misconfiguration cost an hour | Yes |
| Fire OS / Fire TV | Overlay ticker over any app, remote OK, ADB | Overlays and focus work on Fire OS 8.1; wireless ADB incl. `adb reverse` | Official word on overlays; a UI toggle for the overlay permission; docs on which simulator to use | ADB setup was quick; overlay support was unclear | Yes |
| Amazon Bedrock / Amazon Nova | Reading photos, headlines, daily comment, dinner ideas | Converse API; Nova 2 Lite on busy notices; Nova Pro for exact headlines | JSON mode (answers came in code fences); note on new-account verification | Blocked for under an hour on a new account, then smooth | Yes, Nova 2 Lite and Nova Pro |
| AWS Lambda + Function URLs + DynamoDB | The whole backend and household state | One function, no API Gateway; conditional writes; on-demand caps | Nothing blocking | Easy once `aws login` was set up | Yes |
| Amazon Polly | Demo video narration | Natural generative voice without SSML | Nothing blocking | One CLI call | Yes, for future demo videos |
| AWS account, `aws login`, Budgets | First-time AWS setup and cost guardrails | No access keys needed; budget actions as a kill switch | Paid plan needed for promo credits is easy to miss; a "stop at $X" preset | Sign-up to first deploy in one evening | Yes |
| Open-Meteo | Weather and rain margin | No key, one request | Nothing | Minutes | Yes |

## react-native-multi-tv-app-sample (Amazon)

- Good: a working Fire OS build in one command (`yarn dev:android`), remote-control key mapping and
  TV focus handling already wired. Starting from it saved days.
- The README is 540 lines and covers five platforms. A "Fire OS only" quick start would help people
  who own a Fire OS stick and no Vega device.
- `.gitignore` contains a bare `android/`, which also ignores hand-written native modules under
  `modules/*/android/`, so our Kotlin module would have been left out of the repository; we caught it
  before the first commit. Suggest `apps/*/android/`.
- The 22 MB demo GIF in the repository root ends up in every fork.

## Expo modules (expo-modules-core 3.x) on react-native-tvos

- Writing a Kotlin module with `Module`/`ModuleDefinition` and a `BroadcastReceiver` for events was
  straightforward, and `Events("pause")` + `sendEvent` worked first time.
- Friction: `expo-module.config.json` silently accepts the older key `modulesClassNames`. Autolinking
  then resolves the module with an empty `modules: []`, the Kotlin compiles, and the app fails at
  runtime with `Cannot find native module`. A warning for unknown keys would have saved an hour.

## Fire OS / Fire TV platform

- `SYSTEM_ALERT_WINDOW` overlays work on a Fire TV Stick 4K Max (Fire OS 8.1, Android 11), including
  a focusable overlay that receives the remote's OK press. A forum answer from Amazon says overlays
  are unsupported on Fire TV, which nearly made us drop the feature; an official statement would help.
  There is no settings screen to grant the permission; it must be granted with
  `adb shell appops set ... SYSTEM_ALERT_WINDOW allow`. A developer-options toggle would make overlay
  apps demoable without a computer.
- Wireless ADB (`adb connect <ip>:5555`) supports `adb reverse`, so a debug build can reach Metro on
  the development machine without USB. This is not mentioned in the Fire TV ADB guide.
- The Fire TV documentation no longer has a page about emulators (the Fire App Builder page that
  recommended the Android TV emulator returns 404). The hackathon rules mention a "Fire TV/Vega
  simulator", but the only Amazon simulator is the Vega Virtual Device, which does not run Fire OS
  apps. A clear statement of what to use for Fire OS would help.
- The Fire OS overview's version table (Fire OS 6 = API 25 … Fire OS 8 = API 30) is exactly the
  information needed to pick `minSdkVersion`; linking it from the Fire TV "getting started" page would help.

## Amazon Bedrock / Amazon Nova

How we use it: the Converse API from Lambda, through cross-region inference profiles. Nova 2 Lite
reads photos (school notices, receipts, chore evidence) and answers in JSON. Nova Pro writes the
news-style headlines, the daily comment and dinner ideas. Answers are cached per fact in DynamoDB.

- **Photo reading.** On a test notice with a field trip at the top and a bake sale at the bottom,
  Nova Lite (v1) returned only the field trip, even when its own `summary` mentioned the bake sale and
  the prompt said to include every dated activity. Nova 2 Lite returned both, in 2 of 2 runs, with
  the same prompt. A receipt came back as five food items with sensible shelf lives; the plastic bag
  and the point discount were correctly skipped. A 1100×1400 JPEG took about 3–4 s end to end.
- **Headlines.** Short facts invite invention. From "The Spinach in the kitchen should be used today"
  Nova Micro and Nova 2 Lite added a "family meeting at noon"; from a receipt photo summary one model
  added "$120 worth of groceries". What fixed it: passing concrete facts (the actual items added)
  instead of a one-line summary, temperature 0.3–0.4, and a rule against new facts. At 0.4, Nova Pro
  was the only model that kept every time and name right across our seven test facts (about 1.0–1.4 s
  each), including the one that matters most, the time to leave.
- **JSON.** Even with "JSON only" in the system prompt, answers usually came wrapped in a
  ```` ```json ```` fence. A JSON mode (or a documented way to turn off the fence) would help.
- **New accounts.** For the first hour after sign-up, every Converse call failed with
  `AccessDeniedException: Your account is currently being verified`, while DynamoDB and Lambda
  already worked. The message is clear; mentioning this in the Bedrock getting-started page would save
  newcomers a debugging detour.
- The Converse API's uniform `system` + `messages` shape made it easy to keep one thin client
  (`backend/src/model/bedrock.mjs`) and a canned stand-in for local development.

## AWS Lambda Function URLs + DynamoDB

How we use it: one Node.js 22 function (arm64, 512 MB) behind a Function URL serves the TV, the
overlay service and the phone page. The whole household is one DynamoDB item with a version number.

- Cold starts were 530–610 ms of init with the AWS SDK v3 Bedrock and DynamoDB clients bundled;
  memory use stayed around 120–135 MB.
- DynamoDB conditional writes (`#v = :v`) gave a simple optimistic-concurrency story for a
  single-item household state. The 400 KB item limit made us shrink chore photos (400 px, JPEG 70%,
  about 20 KB each) and keep only the latest four.
- On-demand tables accept a maximum throughput (`--on-demand-throughput`), which doubles as a cost cap.

## Amazon Polly (demo video narration)

- The demo video's narration is Amazon Polly's generative engine (voice "Matthew"), synthesized one
  sentence at a time so each caption could be timed exactly to its audio clip. About 1,300 characters
  for the whole video; the voice sounded natural enough for a news-anchor style without any SSML.

## Getting started on AWS as a first-time user

- `aws login` (console credentials in the CLI) removed the scariest step for a first-time AWS user:
  no access keys to create or store. The JavaScript SDK v3 picked up the same credentials with no
  extra setup.
- Choosing the **Paid** plan at sign-up is required to redeem hackathon promotional credits (the Free
  plan is "not eligible for other promotional credits"). That is easy to miss in the sign-up flow.
- To make "no surprise bills" concrete we used AWS Budgets: e-mail alerts at $1, $5 and $10 of usage
  (credits excluded), and a budget action that attaches a deny-all policy to the function's role at
  $10. Budget actions are a good kill switch for hobby projects; a one-click "stop spending at $X"
  preset in the console would make this much more approachable.

## Open-Meteo

- No API key, one request for current + daily forecast, fast. Used for the rain margin in the
  departure countdown.
