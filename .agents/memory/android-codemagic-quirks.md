---
name: Android Codemagic build quirks
description: Lessons from setting up the Android Capacitor + Codemagic CI pipeline for this project.
---

# Android Codemagic build quirks

## Instance type
- All Linux instances (`linux`, `linux_x2`, etc.) require a paid Codemagic plan.
- Free tier is Mac only: use `mac_mini_m1` or `mac_mini_m2`.
- macOS requires `sed -i ''` (not `sed -i`) and `base64 -d` (not `base64 --decode`).

## Java version
- Capacitor 8.x sets `sourceCompatibility JavaVersion.VERSION_21`. Must use `java: 21` in the workflow environment — Java 17 fails with "invalid source release: 21".

## Keystore generation
- OpenSSL 3.x default PKCS12 (SHA-256 MAC) causes "Failed PKCS12 integrity checking" in Android Gradle's bundletool.
- **Fix:** generate with `-legacy` flag: `openssl pkcs12 -export -legacy ...`
- Also strip whitespace before decoding in CI: `echo "$ANDROID_KEYSTORE_BASE64" | tr -d '[:space:]' | base64 -d > keystore`
- Keystore for this project: alias=`fbr-key`, password=`FbrAndroid@2027!`, backed up at `docs/android-signing/fbr-release.keystore` (gitignored).

## AAB find command
- `find android -name "*.aab"` picks up `intermediary-bundle.aab` before the signed release bundle.
- **Fix:** target the exact path: `find artifacts/compare-reviews/android/app/build/outputs/bundle/release -name "*.aab"`

## Publish step
- `@google/play-publisher` npm package does not exist (404). Use the Google API Python client instead: `pip3 install google-api-python-client google-auth` then Python script using `service.edits()`.

## Version code
- Google Play requires each upload to have a strictly higher versionCode.
- First manual upload used versionCode 1. CI uses `CM_BUILD_NUMBER + 1` as offset so it's always > 1.
- **Why:** `${CM_BUILD_NUMBER:-1}` defaults to 1, colliding with the mandatory first manual upload.

## First upload
- Google requires the very first version to be uploaded manually via Play Console UI regardless of API setup.
- Automated publishing via service account only works for subsequent builds.
