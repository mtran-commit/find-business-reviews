# Android Google Play Publishing — Complete Setup Guide
### For any Replit app using Capacitor + Codemagic CI

This guide walks through the entire pipeline from a fresh Replit project to
automatic publishing on Google Play. Follow every section in order. Time to
complete: ~2–3 hours (mostly waiting on account provisioning and first build).

---

## Prerequisites

Before starting, confirm your app has:

- [ ] A **Capacitor** project inside the repo (i.e. `capacitor.config.ts` or
  `capacitor.config.json` and an `android/` folder exist, or you have run
  `npx cap add android` at some point)
- [ ] A unique **package name** in reverse-domain format, e.g.
  `com.yourcompany.appname` — set in `capacitor.config.ts` under `appId`
- [ ] A **Codemagic** account at [codemagic.io](https://codemagic.io) connected
  to your Replit repository via GitHub
- [ ] A **Google Play Developer account** at
  [play.google.com/console](https://play.google.com/console) ($25 one-time fee)
- [ ] A **Google account** for Google Cloud Console

---

## Overview of what you are building

```
Replit (code) ──push──► GitHub ──trigger──► Codemagic
                                                │
                                    ┌───────────┴────────────┐
                                    │  1. pnpm install        │
                                    │  2. Build web app       │
                                    │  3. cap sync android    │
                                    │  4. Decode keystore     │
                                    │  5. Gradle bundleRelease│
                                    │  6. Sign AAB            │
                                    │  7. Publish to Play ────┼──► Google Play
                                    └────────────────────────┘     Internal track
```

---

## Part 1 — Generate the Android signing keystore

The keystore is the cryptographic identity of your app on Google Play.
**You must never lose it.** Google permanently ties your app listing to the
first key you upload. There is no recovery if you lose the key.

### Why OpenSSL instead of keytool?

`keytool` (part of the Java JDK) is often unavailable in Replit and on machines
without Java installed. OpenSSL is always available and produces a
PKCS12-format keystore that Android Gradle Plugin accepts natively.

### Generate the keystore in Replit's shell

Open the Replit shell and run:

```bash
# Replace these values before running
APP_ALIAS="myapp"                    # short lowercase name, no spaces
STORE_PASSWORD="MyApp@2027!"         # strong password, save this

openssl req -x509 -newkey rsa:4096 \
  -keyout /tmp/key.pem \
  -out /tmp/cert.pem \
  -days 10000 -nodes \
  -subj "/CN=My App Release/OU=Mobile/O=My Company/L=City/ST=State/C=AU"

openssl pkcs12 -export \
  -in /tmp/cert.pem \
  -inkey /tmp/key.pem \
  -name "$APP_ALIAS" \
  -out /tmp/myapp-release.keystore \
  -passout pass:"$STORE_PASSWORD"

# Verify it was created
ls -lh /tmp/myapp-release.keystore

# Encode to base64 (you will paste this into Codemagic)
base64 /tmp/myapp-release.keystore
```

**Copy the entire base64 output** — you need it in Part 2.

> ⚠️ PKCS12 format has a single password that acts as both the store password
> and the key password. Use the same value for both `ANDROID_STORE_PASSWORD`
> and `ANDROID_KEY_PASSWORD` in Codemagic.

### Back up the keystore — do this now

Save the following to your password manager (1Password, Bitwarden, etc.)
before continuing:

| What | Value |
|---|---|
| Key alias | `myapp` (whatever you set) |
| Store password | your chosen password |
| Key password | same as store password |
| Keystore (base64) | the entire base64 string |

Also save the raw file somewhere safe:

```bash
# Optional: keep a backup copy in the repo (must be gitignored — see below)
mkdir -p docs/android-signing
cp /tmp/myapp-release.keystore docs/android-signing/myapp-release.keystore
```

Add to `.gitignore`:

```
docs/android-signing/
*.keystore
*.jks
```

---

## Part 2 — Codemagic environment variables

In [Codemagic](https://codemagic.io) → your app → **Environment variables** →
create a new **group** named `myapp_android_keystore` (replace `myapp`).

Add these five variables to the group:

| Variable name | Value | Secure? |
|---|---|---|
| `ANDROID_KEYSTORE_BASE64` | The base64 string from Part 1 | ✅ Yes |
| `ANDROID_KEY_ALIAS` | `myapp` (your alias) | No |
| `ANDROID_STORE_PASSWORD` | Your chosen password | ✅ Yes |
| `ANDROID_KEY_PASSWORD` | Same as store password | ✅ Yes |
| `PACKAGE_NAME` | `com.yourcompany.appname` | No |

> **`GCLOUD_SERVICE_ACCOUNT_CREDENTIALS`** — do **not** add this yet. Leave it
> out entirely until Part 5. An absent variable is handled gracefully by the
> pipeline; an empty one causes a JSON parse crash.

---

## Part 3 — codemagic.yaml workflow

Add the following workflow to your `codemagic.yaml`. This is a complete,
self-contained Android build workflow for a Capacitor app in a pnpm monorepo.

Customise the values marked with `# ← CHANGE THIS`.

```yaml
workflows:
  android-capacitor:
    name: "My App Android (Capacitor)"   # ← CHANGE THIS
    instance_type: mac_mini_m2
    max_build_duration: 60
    environment:
      groups:
        - myapp_android_keystore         # ← CHANGE THIS (your group name)
      node: 20
      java: 17
    scripts:
      - name: Set up pnpm
        script: |
          set -e
          npm install -g pnpm@9
          pnpm --version

      - name: Install dependencies
        script: |
          set -e
          # Rewrite lockfile server URL for Codemagic compatibility
          sed -i '' 's|https://[^/]*\.replit\.dev|https://registry.npmjs.org|g' \
            pnpm-lock.yaml 2>/dev/null || true
          pnpm install --frozen-lockfile

      - name: Build web app
        script: |
          set -e
          # ← CHANGE THIS: replace with your actual build command and output dir
          pnpm --filter @workspace/my-app run build
          test -d artifacts/my-app/dist || \
            { echo "ERROR: build output not found" >&2; exit 1; }

      - name: Sync web build into Android
        script: |
          set -e
          # ← CHANGE THIS: replace with path to your Capacitor app
          cd artifacts/my-app
          npx cap sync android
          echo "=== cap sync android complete ==="

      - name: Decode keystore
        script: |
          set -e
          KEYSTORE_PATH="/tmp/myapp-release.keystore"  # ← CHANGE THIS filename
          echo "$ANDROID_KEYSTORE_BASE64" | base64 --decode > "$KEYSTORE_PATH"
          test -s "$KEYSTORE_PATH" || \
            { echo "ERROR: decoded keystore is empty" >&2; exit 1; }
          echo "Keystore decoded ($(wc -c < "$KEYSTORE_PATH") bytes)"

      - name: Build signed AAB
        script: |
          set -e
          KEYSTORE_PATH="/tmp/myapp-release.keystore"  # ← CHANGE THIS (same as above)
          test -s "$KEYSTORE_PATH" || \
            { echo "ERROR: keystore missing — did Decode keystore step run?" >&2; exit 1; }

          # ← CHANGE THIS: path to your android/ directory
          cd artifacts/my-app/android
          echo "=== Running ./gradlew bundleRelease ==="
          ./gradlew bundleRelease \
            -Pandroid.injected.signing.store.file="$KEYSTORE_PATH" \
            -Pandroid.injected.signing.store.password="$ANDROID_STORE_PASSWORD" \
            -Pandroid.injected.signing.key.alias="$ANDROID_KEY_ALIAS" \
            -Pandroid.injected.signing.key.password="$ANDROID_KEY_PASSWORD" \
            2>&1 | tail -80

          AAB=$(find app/build/outputs/bundle/release -name "*.aab" | head -1)
          test -n "$AAB" || { echo "ERROR: no AAB found after bundleRelease" >&2; exit 1; }
          echo "=== Built AAB: $AAB ($(du -h "$AAB" | cut -f1)) ==="

      - name: Publish to Google Play internal track (skipped if credentials not set)
        script: |
          set -e
          if [ -z "${GCLOUD_SERVICE_ACCOUNT_CREDENTIALS:-}" ]; then
            echo "======================================================"
            echo "  GCLOUD_SERVICE_ACCOUNT_CREDENTIALS is not set."
            echo "  Skipping automatic Google Play publish."
            echo ""
            echo "  Next step: download the .aab from the Artifacts tab"
            echo "  and upload it manually in Play Console:"
            echo "  Testing > Internal testing > Create new release"
            echo "======================================================"
            exit 0
          fi

          # ← CHANGE THIS: path to match your android directory above
          AAB=$(find artifacts/my-app/android/app/build/outputs/bundle/release \
            -name "*.aab" | head -1)
          if [ -z "$AAB" ]; then
            echo "ERROR: No AAB found to publish" >&2
            exit 1
          fi
          echo "=== Publishing $AAB to Google Play internal track ==="

          echo "$GCLOUD_SERVICE_ACCOUNT_CREDENTIALS" > /tmp/gplay-creds.json
          pip3 install --quiet google-api-python-client google-auth 2>/dev/null

          python3 - "$AAB" "$PACKAGE_NAME" <<'PYEOF'
          import sys, os
          from googleapiclient.discovery import build
          from googleapiclient.http import MediaFileUpload
          from google.oauth2 import service_account

          aab_path, package_name = sys.argv[1], sys.argv[2]

          creds = service_account.Credentials.from_service_account_file(
              '/tmp/gplay-creds.json',
              scopes=['https://www.googleapis.com/auth/androidpublisher']
          )
          service = build('androidpublisher', 'v3', credentials=creds)

          edit = service.edits().insert(body={}, packageName=package_name).execute()
          edit_id = edit['id']

          media = MediaFileUpload(aab_path, mimetype='application/octet-stream',
                                  resumable=True)
          bundle = service.edits().bundles().upload(
              packageName=package_name, editId=edit_id, media_body=media
          ).execute()
          version_code = bundle['versionCode']
          print(f'Uploaded bundle versionCode={version_code}')

          service.edits().tracks().update(
              packageName=package_name, editId=edit_id, track='internal',
              body={'releases': [{'versionCodes': [str(version_code)],
                                  'status': 'draft'}]}
          ).execute()

          service.edits().commit(packageName=package_name, editId=edit_id).execute()
          print(f'Published to internal track as draft (versionCode={version_code})')
          PYEOF

    artifacts:
      # ← CHANGE THIS: match your android directory path
      - artifacts/my-app/android/app/build/outputs/bundle/release/*.aab
```

### How signing works (no build.gradle changes needed)

The pipeline passes signing credentials to Gradle at build time using
`-P` flags (`android.injected.signing.*`). This avoids modifying
`build.gradle` and works with any Capacitor project out of the box.

---

## Part 4 — Create the app in Google Play Console

1. Go to [play.google.com/console](https://play.google.com/console)
2. Click **Create app**
3. Fill in:
   - **App name** — your app's display name
   - **Default language** — English (or your primary language)
   - **App or game** — App
   - **Free or paid** — Free (can change later)
4. Tick both policy declarations → **Create app**

Your app is now registered with the package name from `capacitor.config.ts`.

### Complete minimum store listing (required before upload)

Play Console will block your first upload until the store listing is minimally
complete. Fill in:

- **App** → **Store presence** → **Main store listing**:
  - Short description (80 chars)
  - Full description (4000 chars max)
  - At least 2 screenshots (phone)
  - Feature graphic (1024×500 px)
  - App icon (512×512 px, PNG)
- **App** → **Store presence** → **App content**:
  - Privacy policy URL
  - Target audience (age group)
  - Content rating questionnaire → generate rating
  - News apps declaration (if applicable)

---

## Part 5 — Set up Google Play API access (service account)

This allows Codemagic to publish builds automatically.

> ℹ️ **Google Play Console no longer has a dedicated "API access" tab.**
> The workflow now goes entirely through Google Cloud Console and the
> **Users and permissions** section of Play Console.

> ⏳ If this is your first time using Google Cloud Console, your account may
> take a few minutes to provision. If you see a loading screen, wait and refresh.

### Part 5A — Enable the Google Play Developer API

1. Sign in to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new Google Cloud project (e.g. `My App`) or select an existing one
   — confirm it is selected in the top dropdown
3. Left menu → **APIs & Services** → **Library**
4. Search for **Google Play Developer API** → click it → **Enable**

### Part 5B — Create a service account

1. Left menu → **IAM & Admin** → **Service accounts**
2. Click **+ Create service account** at the top
3. Fill in:
   - **Service account name**: `codemagic-publisher`
   - **Service account ID**: auto-fills
4. Click **Create and continue**
5. Skip the optional role assignment → click **Done**
6. Find `codemagic-publisher` in the list → click on it
7. Go to the **Keys** tab → **Add key** → **Create new key** → **JSON** → **Create**
8. A `.json` file downloads automatically — this is your credentials file

### Part 5C — Grant Play Console permissions to the service account

1. Open the downloaded `.json` file — find and copy the `"client_email"` value,
   which looks like:
   `codemagic-publisher@your-project-id.iam.gserviceaccount.com`
2. In Play Console → left sidebar → **Users and permissions**
3. Click **Invite new user**
4. Paste the service account email into the **Email address** field
5. Under **Account permissions**, check:
   - **Release apps to testing tracks** ← minimum required
   - Optionally also: **Manage store presence** if you want CI to update listings
6. Click **Invite user** → **Send invitation**

> ⚠️ The invitation may take up to 24 hours to activate on Google's side,
> though it usually works within minutes.

### Part 5D — Add credentials to Codemagic

1. Open the downloaded `.json` file in any text editor
2. Select all → copy the entire contents
3. In Codemagic → your app → **Environment variables** →
   open your `myapp_android_keystore` group
4. Add a new variable:
   - **Name**: `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS`
   - **Value**: paste the entire JSON
   - **Secure**: ✅ Yes
5. Save

---

## Part 6 — Trigger the first build

1. In Codemagic → your app → **Start new build**
2. Select branch (e.g. `main`) and workflow `android-capacitor`
3. Click **Start new build**

The build takes 15–30 minutes on the first run (Gradle downloads dependencies).

### What to expect

| Phase | Expected result |
|---|---|
| pnpm install | ✅ Passes |
| Web build | ✅ Passes |
| cap sync | ✅ Passes |
| Gradle bundleRelease | ✅ Passes (~10–20 min) |
| Publish step | ✅ Skips gracefully if credentials not set yet |
| Artifacts | `.aab` file available to download |

If the build fails, the `.aab` is still available in the **Artifacts** tab even
on a failed build — Codemagic always collects artifacts before marking the
overall status.

---

## Part 7 — Manual first upload (required by Google)

Google Play requires the very first version of an app to be uploaded manually
through the web interface. Automated publishing only works for subsequent
updates.

1. In Play Console → left sidebar → **Testing** → **Internal testing**
2. Click **Create new release**
3. Under **App bundles**, click **Upload** → select the `.aab` file you
   downloaded from Codemagic Artifacts
4. In the **Release name** field: `0.0.1 (1)` or similar
5. In **Release notes**: `First internal build`
6. Click **Save** → **Review release** → **Start rollout to Internal testing**

### Add yourself as a tester

Still in **Internal testing**:

1. Click the **Testers** tab
2. Create a new testing group (e.g. `Internal team`)
3. Add your Google account email
4. Click **Save**
5. On your Android device: visit the opt-in link shown under the testing group
   → tap **Join** → install from Play Store

---

## Part 8 — Automatic publishing for all future builds

Once the manual first upload is done, all subsequent Codemagic builds with
`GCLOUD_SERVICE_ACCOUNT_CREDENTIALS` set will:

1. Build a signed AAB
2. Automatically publish it to the **Internal testing** track as a draft
3. Require no manual steps

### Promoting a release to a wider audience

In Play Console → **Testing** → **Internal testing** → select a release →
**Promote release** → choose the target track:

| Track | Audience |
|---|---|
| Internal testing | Up to 100 testers, instant |
| Closed testing (Alpha) | Invite-only groups |
| Open testing (Beta) | Anyone can join |
| Production | Full public release |

Each promotion goes through a short review (seconds to hours for testing tracks,
days for production).

---

## Part 9 — Version code management

Android requires each release to have a higher `versionCode` than the last.
The Capacitor Gradle project auto-increments based on the value in
`capacitor.config.ts` → `android.buildOptions.keystoreAlias` or via the
`android/app/build.gradle` `versionCode` field.

**Recommended:** Use Codemagic's build number as the version code.

In `android/app/build.gradle`:

```groovy
android {
    defaultConfig {
        versionCode System.getenv("CM_BUILD_NUMBER")?.toInteger() ?: 1
        versionName "1.0.0"  // update this manually for user-facing versions
    }
}
```

This auto-increments every Codemagic build without any manual edits.

---

## Troubleshooting

### Build fails: `ANDROID_KEYSTORE_BASE64` is empty
- Confirm the env group name in `codemagic.yaml` matches exactly what you
  created in Codemagic (case-sensitive)
- Confirm the variable is in the group, not a different group

### Build fails: `No such file or directory: android/`
- Run `npx cap add android` in the Replit shell, commit the result, and push
- Make sure `cap sync android` has been run at least once locally

### Build fails: Gradle license error
- Gradle needs Android SDK licenses accepted. Add this step before
  `Decode keystore`:
  ```yaml
  - name: Accept Android SDK licenses
    script: yes | sdkmanager --licenses 2>/dev/null || true
  ```

### Publish fails: `The caller does not have permission`
- The service account invitation in Play Console may not have activated yet.
  Wait 5–10 minutes and re-trigger the build.
- Confirm the `client_email` you invited exactly matches the one in the JSON.

### Publish fails: `Version code already exists`
- Increment `versionCode` in `android/app/build.gradle`
- Or use `CM_BUILD_NUMBER` as described in Part 9

### `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS`: JSON parse error (empty string)
- The variable was added but left blank. Delete it from the Codemagic env group
  entirely — an absent variable skips publishing gracefully; an empty one crashes.

### First upload rejected: `You need to have at least one valid screenshot`
- Complete the store listing in Play Console → **Store presence** → **Main
  store listing** before uploading the AAB

---

## Checklist summary

| | Task |
|---|---|
| ⬜ | Confirm `appId` in `capacitor.config.ts` matches your package name |
| ⬜ | Generate keystore with OpenSSL (Part 1) |
| ⬜ | Back up keystore to password manager |
| ⬜ | Create Codemagic env group with 5 variables (Part 2) |
| ⬜ | Add `android-capacitor` workflow to `codemagic.yaml` (Part 3) |
| ⬜ | Create app in Google Play Console (Part 4) |
| ⬜ | Complete minimum store listing in Play Console (Part 4) |
| ⬜ | Enable Google Play Developer API in Google Cloud (Part 5A) |
| ⬜ | Create service account + download JSON key (Part 5B) |
| ⬜ | Invite service account in Play Console Users & permissions (Part 5C) |
| ⬜ | Add `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS` to Codemagic (Part 5D) |
| ⬜ | Trigger first Codemagic build (Part 6) |
| ⬜ | Download AAB and manually upload to Internal testing (Part 7) |
| ⬜ | Add yourself as internal tester and install the app (Part 7) |
| ⬜ | All future builds now publish automatically (Part 8) |
