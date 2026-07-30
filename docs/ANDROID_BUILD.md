# Android Build (No Mac Required)

You have **three** ways to get an installable Android app. All work without owning a Mac.

---

## Option 1 — GitHub Actions (recommended, zero local setup)

A workflow is already committed at `.github/workflows/android-build.yml`.

### Get a debug APK (for testing on your phone)

1. Push the repo to GitHub.
2. Go to the repo → **Actions** tab → **Android Build** → **Run workflow**.
3. Wait ~5–10 min. Download the `app-debug-apk` artifact.
4. Transfer the `.apk` to your Android phone and open it (enable "Install unknown apps" for your file manager).

Done — the app is on your phone. No Mac, no Android Studio, no Xcode.

### Get a release AAB (for Google Play Store)

You need a signing keystore. Generate one on any machine with Java installed:

```bash
keytool -genkey -v -keystore release.keystore -alias reach4dollars \
  -keyalg RSA -keysize 2048 -validity 10000
```

Then in GitHub → repo **Settings → Secrets and variables → Actions**, add:

| Secret name                  | Value                                     |
| ---------------------------- | ----------------------------------------- |
| `ANDROID_KEYSTORE_BASE64`    | `base64 -w0 release.keystore` output      |
| `ANDROID_KEYSTORE_PASSWORD`  | the password you set                      |
| `ANDROID_KEY_ALIAS`          | `reach4dollars` (or your alias)           |
| `ANDROID_KEY_PASSWORD`       | the key password you set                  |

Re-run the workflow — you'll also get `app-release-aab` in the artifacts. Upload that `.aab` to Google Play Console.

**Keep `release.keystore` safe.** If you lose it, you can never update your Play Store app.

---

## Option 2 — Local build on Windows / Linux

1. Install **Android Studio** (includes SDK + JDK): https://developer.android.com/studio
2. Clone the repo, run:
   ```bash
   npm install
   npm run cap:add:android      # first time only
   npm run cap:android          # opens Android Studio
   ```
3. In Android Studio: **Build → Build Bundle(s) / APK → Build APK(s)** for testing, or **Generate Signed Bundle / APK** for Play Store.

---

## Option 3 — Cloud CI alternatives

- **Codemagic** — 500 free build min/month, hosted Android + iOS.
- **Bitrise** — free tier for open source / small teams.
- **EAS Build** (for Expo, not applicable here — we use Capacitor).

---

## Google Play Store submission checklist

- Google Play Developer account: **$25 one-time**.
- App icon (512×512), feature graphic (1024×500), screenshots.
- Privacy policy URL (required — link to `/privacy` on your site).
- Content rating questionnaire (done in Play Console).
- Package name is already set: `co.dialingfordollars.leads`.

---

## What about iOS later?

When you eventually have Mac access (rent one on **MacinCloud** ~$30 for a week), run:
```bash
npm run cap:add:ios
npm run cap:ios
```
The same Capacitor codebase produces the iOS app — no code changes needed.
