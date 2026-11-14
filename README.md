# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```powershell
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

## Android Google Sign-In and ESP32 BLE

Google Sign-In and BLE require a native development or release build; they do not
work in Expo Go. For Google Sign-In:

1. Enable Google as a provider in Firebase Authentication.
2. Create the Android OAuth client for package `com.naufal.airsense` and add the
   SHA-1 fingerprint of the key used to sign the APK in Firebase/Google Cloud.
   Add the Play App Signing fingerprint separately if publishing through Play.
3. Set the Web OAuth client ID in `.env.local` for local builds:

   ```env
   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
   ```

The client ID is public app configuration, not a private key. Rebuild the APK
after changing it. For APK builds, add it to the EAS project's `preview`
environment:

```bash
eas.cmd env:set --environment preview --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID --value YOUR_WEB_CLIENT_ID --visibility plaintext
```

The Web OAuth client ID can be found in Google Cloud Console under
**APIs & Services → Credentials → OAuth 2.0 Client IDs**. Use the **Web
application** client ID, not the Android client ID. This is required because
the APK uses native Google Sign-In; web login can work without it.

The BLE app expects the ESP32 to advertise a name beginning with `AirSense`,
service UUID `a1b2c3d4-0001-4a5b-9c8d-0123456789ab`, and notify characteristic
`a1b2c3d4-0002-4a5b-9c8d-0123456789ab`. The current contract is a 16-byte,
version-2 frame decoded in `src/lib/device-data.ts`:

| Bytes | Data |
| --- | --- |
| 0 | Magic `0xA5` |
| 1 | Version `2` |
| 2-3 | PM2.5 × 10 (little-endian) |
| 4-5 | PM10 × 10 (little-endian) |
| 6-7 | CO × 100 (little-endian) |
| 8 | SpO₂ (%) |
| 9 | Heart rate (BPM) |
| 10-11 | Sequence number (little-endian) |
| 12-13 | AQI calculated by ESP32 (little-endian; `0xFFFF` means unavailable) |
| 14 | Flags; bit 0 means finger detected |
| 15 | CRC-8 over bytes 0-14 |

AQI is not recalculated by the phone. The app evaluates SpO₂ `<95` (warning)
and `<90` (danger), BPM `<60` or `>100` (warning), and AQI `>100` (warning).
An alert is issued once per episode, escalates if severity rises, and can
re-trigger after all monitored values remain normal for 30 seconds. The app
stores the received sequence number and phone receipt time (`received_at_ms`);
the current firmware frame does not include a sensor timestamp, so it cannot
measure sensor-to-phone latency. The BLE firmware remains responsible for the
existing sampling/deep-sleep cycle; the Android foreground service can scan
and reconnect while the app is backgrounded, but cannot wake a sleeping ESP32.

### Emergency alerts and push notifications

The first-run permission flow requests notifications and foreground/background
location. Android's location service must also be enabled by the user for a
location fix. Local alerts work on the phone. Remote emergency-contact push
uses the `wearable-alert-api` Cloudflare Worker and Firebase Cloud Messaging;
it does not use Firebase Cloud Functions or require Blaze:

1. Revoke any service-account key that has been shared outside a secure secret
   manager. In Google Cloud Console, delete that key. Create a dedicated
   service account for the Worker in project `airsensecp1`, grant it
   **Cloud Datastore User** and **Firebase Cloud Messaging Admin** roles, enable
   the Firestore and Firebase Cloud Messaging APIs, then download a new key.
   Keep that file outside the repository. Never put the private key in the app,
   Git, or chat.
2. From `wearable-alert-api`, install and deploy the Worker:

   ```powershell
   npm.cmd install
   npx.cmd wrangler login
   Get-Content -Raw "$HOME\Downloads\airsense-alert-worker-key.json" | npx.cmd wrangler secret put GOOGLE_SERVICE_ACCOUNT
   npm.cmd run deploy
   ```

   Save the replacement key with that filename outside the repository. Wrangler
   stores the JSON as a secret. The deployed Worker URL is shown after
   deployment; check its `/health` endpoint.
3. Set `EXPO_PUBLIC_ALERT_API_URL` to the Worker base URL (without a trailing
   slash) in the root `.env.local`, for example
   `https://airsense-alert-api.<account>.workers.dev`. Add the same variable to
   the EAS build environment used for the APK, or run:

   ```powershell
   eas.cmd env:set --environment preview --name EXPO_PUBLIC_ALERT_API_URL --value https://airsense-alert-api.YOUR_ACCOUNT.workers.dev --visibility plaintext
   ```
4. Download the Android `google-services.json` for package
   `com.naufal.airsense` into the project root for local builds. It is ignored
   by Git. For EAS builds, provide it using the `GOOGLE_SERVICES_FILE` file
   environment variable. Rebuild the native APK after changing either setting.

The Worker verifies Firebase ID tokens, writes alert logs to
`profile/{uid}/notifications/{notifId}`, stores push tokens, accepts guest
invitations, and sends high-priority FCM. Contacts must be accepted to receive
alerts. A guest invitation opens in AirSense on the recipient's device, so the
guest must install the app first. Cloudflare's free plan has usage limits, and
Firestore still has its own quotas; delivery depends on those limits and
recipient device settings.

The Firestore alert log is written to
`profile/{uid}/notifications/{notifId}`. Its `timestamp` is the server receipt
time; BLE currently supplies no device timestamp. FCM high priority is configured for Android, but final delivery also depends on
device settings and Google Play services.

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
