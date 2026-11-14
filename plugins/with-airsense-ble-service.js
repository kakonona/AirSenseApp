const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require("@expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const PERMISSIONS = [
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE",
  "android.permission.BLUETOOTH_CONNECT",
];

module.exports = function withAirSenseBleService(config) {
  const packageName = config.android.package;
  if (!packageName) {
    throw new Error("AirSense BLE service requires android.package in app config.");
  }

  config = withAndroidManifest(config, (modConfig) => {
    for (const permission of PERMISSIONS) {
      AndroidConfig.Permissions.ensurePermission(
        modConfig.modResults,
        permission,
      );
    }

    const application = modConfig.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error("Android manifest is missing its application element.");
    }
    application.service ??= [];
    const serviceName = `${packageName}.AirSenseBleForegroundService`;
    if (!application.service.some((service) => service.$?.["android:name"] === serviceName)) {
      application.service.push({
        $: {
          "android:name": serviceName,
          "android:exported": "false",
          "android:foregroundServiceType": "connectedDevice|location",
          "android:stopWithTask": "false",
        },
      });
    }
    return modConfig;
  });

  config = withMainApplication(config, (modConfig) => {
    let contents = modConfig.modResults.contents;
    const packageList = "PackageList(this).packages.apply {";
    if (!contents.includes("add(AirSenseBleForegroundServicePackage())")) {
      if (!contents.includes(packageList)) {
        throw new Error(
          "Could not register AirSenseBleForegroundServicePackage in MainApplication.",
        );
      }
      contents = contents.replace(
        packageList,
        `${packageList}\n          add(AirSenseBleForegroundServicePackage())`,
      );
    }
    modConfig.modResults.contents = contents;
    return modConfig;
  });

  return withDangerousMod(config, [
    "android",
    async (modConfig) => {
      const sourceDirectory = path.join(
        modConfig.modRequest.projectRoot,
        "native",
        "android",
      );
      const targetDirectory = path.join(
        modConfig.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
        ...packageName.split("."),
      );
      fs.mkdirSync(targetDirectory, { recursive: true });

      for (const filename of [
        "AirSenseBleForegroundService.kt",
        "AirSenseBleForegroundServiceModule.kt",
      ]) {
        const source = fs.readFileSync(path.join(sourceDirectory, filename), "utf8");
        fs.writeFileSync(
          path.join(targetDirectory, filename),
          source.replaceAll("__PACKAGE__", packageName),
        );
      }
      return modConfig;
    },
  ]);
};
