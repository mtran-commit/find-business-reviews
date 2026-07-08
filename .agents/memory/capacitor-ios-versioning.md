---
name: Capacitor iOS marketing version on CI
description: Regenerated Capacitor iOS projects always default to version 1.0; Apple closes an approved version train, so CI must set the marketing version explicitly.
---

The iOS project is regenerated fresh on every CI build (`npx cap add ios`), so `CFBundleShortVersionString` always defaults to 1.0. Once Apple approves version 1.0 on the App Store, that "train" closes — uploads fail with codes 90186 ("Invalid Pre-Release Train") and 90062 (version must be higher than previously approved).

**Why:** Build uploads started failing right after the 1.0 release was approved.

**How to apply:** CI must run `agvtool new-marketing-version "$APP_VERSION"` before archiving (an `APP_VERSION` var in `codemagic.yaml`). Bump `APP_VERSION` for every new App Store release; the build number is separate (`agvtool new-version -all $BUILD_NUMBER`).
