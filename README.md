# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
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
eas env:set --environment preview --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID --value YOUR_WEB_CLIENT_ID --visibility plaintext
```

The Web OAuth client ID can be found in Google Cloud Console under
**APIs & Services → Credentials → OAuth 2.0 Client IDs**. Use the **Web
application** client ID, not the Android client ID. This is required because
the APK uses native Google Sign-In; web login can work without it.

The BLE app expects the ESP32 to advertise a name beginning with `AirSense`,
service UUID `a1b2c3d4-0001-4a5b-9c8d-0123456789ab`, and notify characteristic
`a1b2c3d4-0002-4a5b-9c8d-0123456789ab`. Notifications must use the 14-byte
version-1 frame decoded in `src/lib/device-data.ts`. The app cannot connect or
read sensor values until the ESP32 firmware implements this same contract.

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
