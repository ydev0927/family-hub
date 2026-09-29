# Product feedback (tools, APIs and SDKs used)

Feedback from building Family Hub, per tool. Items marked *pending* will be filled in once the AWS
side is live (the project was developed against canned model answers while waiting for credits).

## react-native-multi-tv-app-sample (Amazon)

- Good: a working Fire OS build in one command (`yarn dev:android`), remote-control key mapping and
  TV focus handling already wired. Starting from it saved days.
- The README is 540 lines and covers five platforms. A "Fire OS only" quick start would help people
  who own a Fire OS stick and no Vega device.
- `.gitignore` contains a bare `android/`, which also ignores hand-written native modules under
  `modules/*/android/`. We lost our Kotlin module from the first commit attempt. Suggest `apps/*/android/`.
- The 22 MB demo GIF in the repository root ends up in every fork.

## Expo modules (expo-modules-core 3.x) on react-native-tvos

- Writing a Kotlin module with `Module`/`ModuleDefinition` and a `BroadcastReceiver` for events was
  straightforward, and `Events("pause")` + `sendEvent` worked first time.
- Friction: `expo-module.config.json` silently accepts the older key `modulesClassNames`. Autolinking
  then resolves the module with an empty `modules: []`, the Kotlin compiles, and the app fails at
  runtime with `Cannot find native module`. A warning for unknown keys would have saved an hour.

## Fire OS / Fire TV platform

- `SYSTEM_ALERT_WINDOW` overlays work on Fire OS (Android 7.1–11), but there is no settings screen to
  grant the permission; it must be granted with `adb shell appops set ... SYSTEM_ALERT_WINDOW allow`.
  A developer-options toggle would make overlay apps demoable without a computer.
- The Fire TV documentation no longer has a page about emulators (the Fire App Builder page that
  recommended the Android TV emulator returns 404). The hackathon rules mention a "Fire TV/Vega
  simulator", but the only Amazon simulator is the Vega Virtual Device, which does not run Fire OS
  apps. A clear statement of what to use for Fire OS would help.
- The Fire OS overview's version table (Fire OS 6 = API 25 … Fire OS 8 = API 30) is exactly the
  information needed to pick `minSdkVersion`; linking it from the Fire TV "getting started" page would help.

## Amazon Bedrock / Amazon Nova

- *pending*: prompt adherence for JSON answers (Nova Lite for vision, Nova Micro for text),
  latency of the Converse API from Lambda, and behaviour of the image input limits.
- Design-time note: the Converse API's uniform `system` + `messages` shape made it easy to keep one
  thin client (`backend/src/model/bedrock.mjs`) and a canned stand-in for local development.

## AWS Lambda Function URLs + DynamoDB

- *pending*: cold-start latency with the AWS SDK v3 clients, and the Function URL payload format
  (`requestContext.http.method`, base64 bodies) in practice.
- Design-time note: DynamoDB conditional writes (`#v = :v`) gave a simple optimistic-concurrency
  story for a single-item household state.

## Open-Meteo

- No API key, one request for current + daily forecast, fast. Used for the rain margin in the
  departure countdown.
