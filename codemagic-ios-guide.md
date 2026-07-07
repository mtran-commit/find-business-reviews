# Find Business Reviews — iOS App via Codemagic (no Mac required)

This guide builds and uploads the **iOS** app to the App Store using
**Codemagic**, a cloud CI/CD service that runs the iOS build on **cloud macOS
machines**. You never need to own a Mac — everything you do locally works from
Ubuntu/Windows plus a browser.

The plan: wrap the existing web app (`artifacts/compare-reviews`) in a
**Capacitor** native shell (a web bundle shipped inside a native iOS app).
The app keeps talking to the live backend at **https://findbusinessreviews.com**,
so the Replit deployment must stay **published** — the native app is a client
of the live API, not a copy of it.

> Capacitor (not Expo/React Native) is the right tool here because the app is a
> plain HTML/JS web app, not a React Native project. Codemagic supports
> Capacitor directly.

## How this repo differs from a typical Capacitor project

This is a **pnpm monorepo**; the web app lives in `artifacts/compare-reviews`
and builds with Vite to `artifacts/compare-reviews/dist/public`. Two things
matter for mobile:

1. **API URLs.** The frontend calls the API with a relative base
   (`const API_BASE = '/api'` in `index.html`). Inside the native shell the
   page is served from `capacitor://localhost`, so relative `/api/...` calls
   would fail. Before the first build, `API_BASE` must detect the native shell
   and switch to the absolute URL:

   ```js
   const IS_NATIVE = window.location.protocol === 'capacitor:';
   const API_BASE = IS_NATIVE ? 'https://findbusinessreviews.com/api' : '/api';
   ```

2. **Asset base path.** The Vite config requires a `BASE_PATH` env var. For the
   native bundle it must be relative so assets load from the local shell:
   build with `BASE_PATH=./` (see the yaml below).

**Server CORS is already fine** — the API uses `app.use(cors())` (allows all
origins, including `capacitor://localhost`). No server change needed; just keep
the app published.

## One-time repo setup (DONE)

All of the following is already committed in this repo:

- [x] Capacitor installed in `artifacts/compare-reviews`
      (`@capacitor/core`, `@capacitor/ios`, `@capacitor/cli`, `@capacitor/assets`).
- [x] `artifacts/compare-reviews/capacitor.config.json`:

  ```json
  {
    "appId": "com.findbusinessreviews.app",
    "appName": "Find Business Reviews",
    "webDir": "dist/public"
  }
  ```

- [x] `API_BASE` native detection added to `index.html` (native shell calls
      `https://findbusinessreviews.com/api`).
- [x] Icon/splash source art generated from the brand logo:
      `artifacts/compare-reviews/resources/icon.png` (1024×1024, white bg) and
      `resources/splash.png` (2732×2732, navy `#071A3D` bg).
- [x] `codemagic.yaml` committed at the repo root.

## Prerequisites (one-time, outside the repo)

- **Apple Developer Program membership** — US$99/year at
  <https://developer.apple.com/programs/>. Required for App Store distribution;
  enrollment can take a day or two.
- **App Store Connect app record** with bundle id
  **`com.findbusinessreviews.app`** (step 3 below).
- **Code hosted on GitHub** (or GitLab/Bitbucket) — Codemagic builds from Git.
- **A free Codemagic account** — <https://codemagic.io>, sign up with your Git
  provider.
- **No Mac required.**

## About the `ios/` native project

Capacitor's `ios/` Xcode project is normally created with `npx cap add ios`,
which needs macOS. Two options:

- **Option A — let Codemagic generate it during each build (recommended).**
  The cloud Mac runs `npx cap add ios` fresh every build. Nothing iOS-native
  lives in the repo. This guide uses Option A.
- **Option B — commit a pre-generated `ios/` folder.** Only needed if you later
  require custom native changes (entitlements, extra plugins).

## Step-by-step

### 1. Push the project to GitHub

```bash
git remote -v          # confirm your GitHub remote, or add one:
# git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

### 2. Enroll in the Apple Developer Program

Complete enrollment at <https://developer.apple.com/programs/>.

### 3. Create the App Store Connect app record

At <https://appstoreconnect.apple.com> → **Apps → +**:

- Platform **iOS**, name **Find Business Reviews**, bundle id
  **`com.findbusinessreviews.app`**, SKU any unique string
  (e.g. `findbusinessreviews-ios`).
- The listing (description, screenshots, privacy, rating) is completed before
  submitting for review — see App Review notes at the end.

### 4. Create an App Store Connect API key

Lets Codemagic upload builds without your Apple password.
**Users and Access → Integrations → App Store Connect API → +**, role
**App Manager**. Download the `.p8` file (one-time download) and note the
**Key ID** and **Issuer ID**.

### 5. Connect the API key in Codemagic

Codemagic → **Teams / Settings → Integrations → Apple Developer Portal /
App Store Connect**: upload the `.p8`, enter Key ID + Issuer ID, and name the
integration (e.g. `fbr_app_store`). Codemagic uses it for both automatic code
signing and publishing.

### 6. Add the app in Codemagic

**Add application** → pick your Git provider → select this repo → project type
**Other / Capacitor**. Configure via the committed `codemagic.yaml` below
(reproducible and version-controlled).

### 7. Add `codemagic.yaml` to the repo root

Use the sample in the next section, then:

```bash
git add codemagic.yaml
git commit -m "Add Codemagic iOS build config"
git push
```

### 8. Run the build

Start the `ios-capacitor` workflow in Codemagic. On a cloud Mac it will:
install pnpm dependencies, build the web app, generate the `ios/` project,
sign with your API key, archive an `.ipa`, and publish it to
App Store Connect / TestFlight.

### 9. Test via TestFlight

Install from **TestFlight** on a real iPhone and verify the full flow against
the live backend: **search (business + location), results page, Trust Score,
free AI Review Sentiment reports, the paid Business Report flow (form →
Stripe Checkout opens in the browser), Terms & Privacy pages.**

### 10. Submit for review

Attach the processed build to your app version in App Store Connect, finish
the listing, and **Submit for Review**.

## Sample `codemagic.yaml`

Place at the repo root. Replace `fbr_app_store` only if you named the
integration differently, and set the numeric Apple app ID after step 3.

```yaml
workflows:
  ios-capacitor:
    name: Find Business Reviews iOS (Capacitor)
    instance_type: mac_mini_m2
    max_build_duration: 60
    environment:
      node: 24                      # bundles npm 11; satisfies Capacitor's Node >= 22
      xcode: latest
      cocoapods: default
      vars:
        BUNDLE_ID: "com.findbusinessreviews.app"
        APP_STORE_APPLE_ID: 6788556329   # numeric Apple ID of the app from App Store Connect
      groups: []
    integrations:
      app_store_connect: fbr_app_store   # the integration name from step 5
    scripts:
      - name: Install pnpm dependencies
        script: |
          set -e
          # The committed pnpm-lock.yaml may pin Replit's internal package proxy
          # (package-firewall.replit.local), unreachable on Codemagic. Rewrite
          # those URLs to the public npm registry for CI only.
          perl -pi -e 's{https?://package-firewall\.replit\.local/npm/}{https://registry.npmjs.org/}g' pnpm-lock.yaml
          npm install -g pnpm
          pnpm config set registry https://registry.npmjs.org/
          pnpm install --frozen-lockfile
      - name: Build the web app (relative base for the native shell)
        script: |
          set -e
          cd artifacts/compare-reviews
          PORT=8080 BASE_PATH=./ pnpm run build     # outputs to dist/public (PORT is required by vite.config but unused for a static build)
      - name: Add iOS platform (cloud Mac)
        script: |
          set -e
          cd artifacts/compare-reviews
          if [ ! -d "ios/App" ]; then
            # Capacitor defaults to Swift Package Manager; force the CocoaPods
            # template so `pod install` can generate App.xcworkspace.
            npx cap add ios --packagemanager CocoaPods
          fi
          ls -la ios/App
      - name: Generate icons & splash
        script: |
          cd artifacts/compare-reviews
          npx capacitor-assets generate --ios || true
      - name: Sync web build into iOS
        script: |
          cd artifacts/compare-reviews
          npx cap sync ios
      - name: Install CocoaPods (generates App.xcworkspace)
        script: |
          set -e
          # Capacitor runs `pod install` during sync but skips it silently if it
          # can't invoke CocoaPods -> no App.xcworkspace -> build-ipa fails.
          cd artifacts/compare-reviews/ios/App
          pod install --repo-update
          test -d App.xcworkspace   # hard-fail here if the workspace wasn't created
      - name: Create signing certificate + provisioning profile
        script: |
          set -e
          keychain initialize
          # Apple caps distribution certificates and each build mints a fresh
          # private key, so clear existing certs first (safe for App Store /
          # TestFlight: Apple re-signs on distribution).
          app-store-connect certificates list --json > /tmp/certs.json 2>/tmp/certs.err \
            || { echo "certificates list failed:"; cat /tmp/certs.err; echo "[]" > /tmp/certs.json; }
          CERT_IDS=$(python3 -c "import json; print(' '.join(c.get('id','') for c in json.load(open('/tmp/certs.json'))))" || true)
          for CID in $CERT_IDS; do
            app-store-connect certificates delete "$CID" </dev/null || echo "WARN: could not delete $CID"
          done
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
          cd artifacts/compare-reviews/ios/App
          agvtool new-version -all $(($BUILD_NUMBER))
      - name: Build & archive (.ipa)
        script: |
          xcode-project build-ipa \
            --workspace "artifacts/compare-reviews/ios/App/App.xcworkspace" \
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

- **`node: 24`** — bundles npm 11 (avoids the old npm "Exit handler never
  called!" crash) and satisfies Capacitor's Node ≥ 22 requirement.
- **Lockfile registry rewrite** — Replit's dev environment resolves packages
  through an internal proxy that is unreachable on Codemagic; the `perl`
  one-liner rewrites those URLs at build time only. The committed lockfile is
  left untouched for Replit.
- **`BASE_PATH=./`** — the monorepo's Vite config requires `BASE_PATH`; a
  relative base makes assets load correctly from `capacitor://localhost`.
- **Monorepo paths** — unlike a single-package repo, every Capacitor command
  runs inside `artifacts/compare-reviews`, and the `.xcworkspace` path in the
  build step includes that prefix.
- **Signing (`fetch-signing-files --create`)** — mints a fresh certificate and
  App Store provisioning profile every build via the App Store Connect API key;
  no manual certificate juggling, no Mac Keychain.

## Backend note (important)

The native app is a thin client of the **live** site. Keep the Replit
deployment **published** at findbusinessreviews.com, or the app will show
errors. Stripe Checkout opens in the system browser (it is a normal https
link), which is App Store-compliant for **physical-world / external services**
like this report product — but be ready to explain the payment flow in App
Review notes.

## App Review checklist

- Complete **App Privacy** in App Store Connect (data collected: search
  queries, report-request contact details; no card data — Stripe handles it).
- Screenshots for 6.7" and 6.5" iPhones (take them in TestFlight).
- A support URL and privacy policy URL (the site's `/privacy` and `/terms`
  pages already exist).
- If review asks about the paid report: it is fulfilled by email, purchased via
  Stripe Checkout in the browser — describe this in the Review Notes field.
