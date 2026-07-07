# Izzy Bin-Y — iOS App via Codemagic (no Mac required)

This guide builds and uploads the **iOS** app to the App Store using
**Codemagic**, a cloud CI/CD service that runs the iOS build on **cloud macOS
machines**. It exists so you can ship the iOS app **without owning a Mac**
(Ubuntu/Windows are fine for everything you do locally).

This app is a **Capacitor** app (a web bundle shipped inside a native shell) —
**not** Expo/React Native. That matters: Expo EAS Build is designed for Expo /
React Native projects and is not the supported path for a Capacitor app like
this one. Codemagic supports Capacitor/Ionic directly, which is why it is the
recommended route here.

> For the Mac-based iOS flow (Xcode), see **`ios-app-guide.md`**. For Android,
> see **`android-app-guide.md`**. All three use the same Capacitor config
> (`capacitor.config.json`) and the same web bundle.

## What is already done (in this repo)

- **Capacitor installed** — `@capacitor/core`, `@capacitor/ios`,
  `@capacitor/cli`, `@capacitor/assets` (and `@capacitor/android`).
- **`capacitor.config.json`** — `appId: com.izzybiny.app`,
  `appName: "Izzy Bin-Y"`, `webDir: dist/public` (the Vite production output).
- **Absolute API calls in the native app** — `client/src/lib/api.js` detects the
  native app and sends requests to `https://izzybiny.com.au` instead of relative
  `/api/...` paths.
- **Server CORS** — `server/cors.js` already allows the iOS Capacitor origin
  (`capacitor://localhost`). **This must be live in production**, so keep the
  Replit web app **published** (see the Backend note below).
- **Icon / splash source art** — `resources/icon.png` (1024×1024) and
  `resources/splash.png` (2732×2732).

## Prerequisites (one-time)

- **Apple Developer Program membership** — US$99/year, at
  <https://developer.apple.com/programs/>. There is no way around this for App
  Store distribution.
- **App Store Connect app record** with bundle id **`com.izzybiny.app`** (created
  in step 3 below).
- **Code hosted on GitHub** (or GitLab/Bitbucket). Codemagic builds from your Git
  repo, so push this project to a repository you control.
- **A Codemagic account** — sign up free with your Git provider at
  <https://codemagic.io>.
- **No Mac required.** Everything below is done in a browser plus a few `git`
  commands from your Ubuntu/Windows machine.

## About the `ios/` native project (important)

Capacitor's `ios/` folder (the Xcode project) is normally created with
`npx cap add ios`, which requires macOS + CocoaPods — so you can't generate it on
Ubuntu/Windows. You have two ways to handle this with Codemagic:

- **Option A — let Codemagic generate it during the build (recommended).** Add
  `npx cap add ios` as a build step so the cloud Mac creates the `ios/` project
  fresh each build. Nothing iOS-native needs to live in your repo. This keeps the
  repo clean and avoids committing generated native code.
- **Option B — commit a pre-generated `ios/` folder.** Only practical if you (or
  someone) ran `npx cap add ios` on a Mac once and committed the result. Then
  Codemagic just runs `npx cap sync ios`. Use this if you need custom native
  changes (entitlements, plugins) checked into the repo.

This guide uses **Option A** in the sample config so you never touch a Mac.

## Step-by-step

### 1. Push the project to GitHub
From your machine:
```bash
git remote -v          # confirm your GitHub remote, or add one:
# git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

### 2. Enroll in the Apple Developer Program
Complete enrollment at <https://developer.apple.com/programs/> (can take a day or
two for approval). You need this before any iOS build can be signed.

### 3. Create the App Store Connect app record
At <https://appstoreconnect.apple.com> → **Apps → +**:
- Platform **iOS**, name **Izzy Bin-Y**, bundle id **`com.izzybiny.app`**, and a
  SKU (any unique string, e.g. `izzybiny-ios`).
- You'll complete the listing (description, screenshots, privacy, rating) before
  submitting for review — see the App Review notes below.

### 4. Create an App Store Connect API key (for uploads)
This lets Codemagic upload builds without your Apple password.
At <https://appstoreconnect.apple.com> → **Users and Access → Integrations →
App Store Connect API** → **+** to create a key with the **App Manager** role.
Download the `.p8` key file (you can only download it once) and note:
- the **Key ID**,
- the **Issuer ID**.

### 5. Connect the API key in Codemagic
In Codemagic → **Teams / Settings → Integrations → Apple Developer Portal** (or
**App Store Connect**): add the integration by uploading the `.p8` file and
entering the **Key ID** and **Issuer ID**. Give it a reference name (e.g.
`izzybiny_app_store`). Codemagic uses this both for **automatic code signing**
and for **publishing** to App Store Connect.

### 6. Add the app in Codemagic
Codemagic → **Add application** → pick your Git provider → select this repo.
Choose **"Other" / capacitor** when asked about project type. You can configure
the build with the **visual workflow editor** or with a **`codemagic.yaml`** file
committed to the repo. A `codemagic.yaml` is recommended because it's
reproducible and version-controlled — a tailored one is provided below.

### 7. Add `codemagic.yaml` to the repo root
Use the sample in the next section. Commit and push it:
```bash
git add codemagic.yaml
git commit -m "Add Codemagic iOS build config"
git push
```

### 8. Run the build
In Codemagic, start a build of the `ios-capacitor` workflow (or enable automatic
builds on push). Codemagic will, on a cloud Mac: install dependencies, build the
web app, generate the `ios/` project, set up signing with your API key, archive a
signed `.ipa`, and publish it to App Store Connect / TestFlight.

### 9. Test via TestFlight
Once the build finishes and App Store Connect processes it, install the app from
**TestFlight** on a real iPhone and verify the full flow against the live
backend: **sign up, log in, dashboard, Biny Bank, donate, QR flyer,
forgot-password email, delete account, Terms & Privacy, footer links.**

### 10. Submit for review
In App Store Connect, attach the processed build to your app version, finish the
store listing, and **Submit for Review** (see notes below).

## Sample `codemagic.yaml`

Place this at the repo root. Replace the two reference names
(`izzybiny_app_store`) only if you named your Codemagic integration differently.

```yaml
workflows:
  ios-capacitor:
    name: Izzy Bin-Y iOS (Capacitor)
    instance_type: mac_mini_m2
    max_build_duration: 60
    environment:
      node: 24                      # Node 24 bundles npm 11 (avoids the npm "Exit handler" bug); satisfies Capacitor 8's Node >= 22
      xcode: latest
      cocoapods: default
      vars:
        BUNDLE_ID: "com.izzybiny.app"
        APP_STORE_APPLE_ID: 0000000000   # numeric Apple ID of the app from App Store Connect
      groups: []
    integrations:
      app_store_connect: izzybiny_app_store   # the integration name from step 5
    scripts:
      - name: Install npm dependencies
        script: |
          # The committed package-lock.json pins Replit's internal package proxy
          # (package-firewall.replit.local), unreachable on Codemagic -> npm hangs.
          # Rewrite those URLs to the public npm registry for CI.
          perl -pi -e 's{https?://package-firewall\.replit\.local/npm/}{https://registry.npmjs.org/}g' package-lock.json
          npm config set registry https://registry.npmjs.org/
          npm ci --no-audit --no-fund
      - name: Build the web app
        script: npm run build           # outputs to dist/public
      - name: Add iOS platform (cloud Mac)
        script: |
          set -e   # fail (and stop) the moment any command errors, so we see the real failure
          if [ ! -d "ios/App" ]; then
            # Capacitor 8 defaults to Swift Package Manager (no Podfile / no .xcworkspace).
            # Force the CocoaPods template so `pod install` can generate App.xcworkspace.
            npx cap add ios --packagemanager CocoaPods
          fi
          echo "=== ios/ contents after cap add ==="
          ls -la ios
          ls -la ios/App
      - name: Generate icons & splash
        script: npx capacitor-assets generate --ios || true
      - name: Sync web build into iOS
        script: npx cap sync ios
      - name: Install CocoaPods (generates App.xcworkspace)
        script: |
          set -e   # without this, a failed `cd`/`pod install` is masked and the step still exits 0
          # Capacitor runs `pod install` during sync, but skips it silently if it can't
          # invoke CocoaPods -> no App.xcworkspace -> build-ipa fails with
          # "Path ios/App/App.xcworkspace does not exist". Run it explicitly to be sure.
          cd ios/App
          echo "=== Podfile present? ==="; ls -la Podfile
          pod install --repo-update   # --repo-update refreshes the spec repo (fixes stale-spec failures)
          echo "=== ios/App contents after pod install ==="; ls -la
          test -d App.xcworkspace   # hard-fail here (not at build-ipa) if the workspace wasn't created
      - name: Create signing certificate + provisioning profile
        script: |
          set -e
          keychain initialize
          # --- Clear Apple's distribution-certificate cap --------------------------
          # Each build generates a fresh private key, so it can never reuse an existing
          # (keyless) certificate and must create a new one. Apple caps distribution
          # certs and returns 409 "You already have a current Distribution certificate"
          # once full. Delete every existing certificate first so there is always room
          # to mint a fresh one. Safe for App Store / TestFlight: Apple re-signs on
          # distribution, so the signing certificate can rotate freely between builds.
          # (</dev/null so a delete can never hang waiting on a confirmation prompt.)
          echo "=== Listing existing certificates ==="
          app-store-connect certificates list --json > /tmp/certs.json 2>/tmp/certs.err \
            || { echo "certificates list failed:"; cat /tmp/certs.err; echo "[]" > /tmp/certs.json; }
          CERT_IDS=$(python3 -c "import json; print(' '.join(c.get('id','') for c in json.load(open('/tmp/certs.json'))))" || true)
          echo "Certificate IDs found: [$CERT_IDS]"
          for CID in $CERT_IDS; do
            echo ">>> Deleting certificate $CID"
            app-store-connect certificates delete "$CID" </dev/null || echo "WARN: could not delete $CID"
          done
          # --- Create a fresh cert + matching App Store provisioning profile -------
          # fetch-signing-files --create needs a private key to actually MINT a cert
          # (without --certificate-key it can only download an existing keyless one).
          # Requires: App ID "com.izzybiny.app" registered in the Apple Developer portal.
          openssl genrsa -out /tmp/ios_cert_key.pem 2048
          app-store-connect fetch-signing-files "$BUNDLE_ID" \
            --type IOS_APP_STORE \
            --certificate-key @file:/tmp/ios_cert_key.pem \
            --create
          keychain add-certificates
      - name: Apply provisioning profiles to the project
        script: xcode-project use-profiles
      - name: Increment build number
        script: |
          cd ios/App
          agvtool new-version -all $(($BUILD_NUMBER))
      - name: Build & archive (.ipa)
        script: |
          xcode-project build-ipa \
            --workspace "ios/App/App.xcworkspace" \
            --scheme "App"
    artifacts:
      - build/ios/ipa/*.ipa
      - /tmp/xcodebuild_logs/*.log
    publishing:
      app_store_connect:
        auth: integration
        submit_to_testflight: true
        # submit_to_app_store: false   # set true when ready to push to review
```

Notes on the sample:
- **`node: 24`** — Node 24 bundles npm 11, which avoids the npm
  `Exit handler never called!` crash seen on older bundled npm; it also satisfies
  the Capacitor 8 CLI's "Node >= 22" requirement.
- **Lockfile registry rewrite (install step)** — this repo's `package-lock.json`
  resolves every package to Replit's internal proxy
  `package-firewall.replit.local`, which is unreachable on Codemagic and makes
  `npm ci` hang for the whole build. The `perl` one-liner rewrites those URLs to
  the public npm registry at build time; the committed lockfile is left untouched
  (the Replit dev environment needs that internal host).
- **Signing — create from scratch (`fetch-signing-files --create`)** — using the
  `app_store_connect` integration (step 5), this step generates a fresh PEM
  private key (`openssl genrsa`) and hands it to `fetch-signing-files`, which then
  creates a **new distribution certificate** *and* a matching App Store
  provisioning profile in one shot; `keychain add-certificates` /
  `xcode-project use-profiles` load and apply them. Key points:
  - **`--certificate-key` is required to create a certificate.** Without a private
    key, `--create` can only *download* an existing certificate, which has no
    private key on the build machine, so the build fails with `Cannot save Signing
    Certificates without certificate private key`. Generating the key in-build
    fixes this.
  - **The App ID `com.izzybiny.app` must be registered** in the Apple Developer
    portal (Certificates, Identifiers & Profiles → Identifiers). Otherwise:
    `No matching profiles found for bundle identifier ... distribution type app_store`.
  - **Certificate limit (auto-rotation).** Apple caps distribution certificates
    per account (commonly 2–3). Because a fresh key is generated each build, a new
    certificate would be created every time and eventually hit that cap, failing
    with `409 ... You already have a current Distribution certificate`. To stay
    self-healing, the signing step first **lists and deletes existing distribution
    certificates** (`app-store-connect certificates list/delete`) before creating
    a fresh one. This is safe for App Store / TestFlight builds — Apple re-signs on
    distribution, so the signing certificate can rotate freely. (If you prefer a
    single stable certificate instead, generate one key, store it as a secure
    Codemagic env var `CERTIFICATE_PRIVATE_KEY`, use
    `--certificate-key @env:CERTIFICATE_PRIVATE_KEY`, and drop the delete loop.)
    (The declarative `ios_signing` environment block only *fetches* existing files
    — it won't create a profile for a brand-new app, so the CLI `--create` flow is
    used here instead.)
- **`--packagemanager CocoaPods` on `cap add ios`** — Capacitor 8's `cap add ios`
  **defaults to Swift Package Manager**, which produces no `Podfile` and no
  `App.xcworkspace`. The archive step (`build-ipa --workspace`) then fails with
  `Path "ios/App/App.xcworkspace" does not exist`. Passing
  `--packagemanager CocoaPods` forces the CocoaPods template so the Podfile (and,
  after `pod install`, the workspace) exist. (Alternative: stay on SPM and build
  with `--project ios/App/App.xcodeproj` instead — but that's a larger change.)
- **Explicit `pod install` (generates `App.xcworkspace`)** — Capacitor runs
  `pod install` during `cap sync`, but if it can't invoke CocoaPods it skips that
  step *silently and still exits 0*, leaving no `ios/App/App.xcworkspace`. The
  archive step then dies with `Path "ios/App/App.xcworkspace" does not exist`.
  Running `pod install` explicitly from `ios/App` guarantees the workspace exists
  before `build-ipa`.
- **`APP_STORE_APPLE_ID`** — the app's numeric Apple ID, found in App Store
  Connect under your app's **App Information** (only needed for some publishing
  setups; safe to leave as-is if unused).
- **`submit_to_testflight: true`** uploads to TestFlight automatically. Flip
  `submit_to_app_store` to `true` only when you want Codemagic to send the build
  into App Store review.
- The scheme/workspace paths (`ios/App/App.xcworkspace`, scheme `App`) are
  Capacitor's defaults — adjust only if you customized the native project.

## Backend note (no changes needed)

The iOS app calls the live backend at **`https://izzybiny.com.au`**. The CORS
allow-list in `server/cors.js` already permits the iOS Capacitor origin
(`capacitor://localhost`), so **no backend change is required** — but the Replit
web app must stay **published** with that code. If login spins or API calls fail
inside the app, an unpublished/stale backend is the usual cause.

## App Store review notes

- **In-app account deletion** — required by Apple for apps with accounts. Already
  supported: **Settings → Delete account**.
- **Privacy policy URL** — required. Use `https://izzybiny.com.au/privacy`.
- **"Minimum functionality" (Guideline 4.2)** — Apple rejects apps that are just
  a website in a shell. Izzy Bin-Y has real account features (Biny Bank tracking,
  QR codes, private alerts, goals, badges); emphasise these in the review notes
  and screenshots.
- **Sign-in for review** — supply a working demo family login in **App Review
  Information** so Apple can sign in.
- **App Privacy questionnaire** — declare that the app collects name + email for
  accounts, consistent with the privacy policy.

## Keeping the app up to date

The native app loads the **bundled** web build, so shipping web changes to the
iOS app means rebuilding and resubmitting. With Codemagic that's simply:
```bash
git commit -am "Update app"
git push          # triggers a new Codemagic build → new TestFlight build
```
Codemagic re-runs `npm run build` + `npx cap sync ios`, bumps the build number,
archives, and uploads. Pure backend/API changes go live by re-publishing the
Replit web app — no resubmission needed, as long as the API shape stays
compatible.
