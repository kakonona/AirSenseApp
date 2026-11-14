const fs = require("node:fs");
const path = require("node:path");

module.exports = ({ config }) => {
  const configuredFile = process.env.GOOGLE_SERVICES_FILE;
  const projectRoot = path.dirname(require.resolve("./app.json"));
  const localFile = path.join(projectRoot, "google-services.json");
  const isEasBuild = process.env.EAS_BUILD === "true";
  const googleServicesFile = configuredFile
    ? path.resolve(configuredFile)
    : localFile;
  const fileExists = fs.existsSync(googleServicesFile);

  if (isEasBuild && (!configuredFile || !fileExists)) {
    throw new Error(
      "EAS Android build requires a readable GOOGLE_SERVICES_FILE file variable.",
    );
  }

  if (fileExists) {
    config.android = {
      ...config.android,
      googleServicesFile:
        googleServicesFile === localFile
          ? "./google-services.json"
          : googleServicesFile,
    };
    console.error(
      `[AirSense config] Android Google Services file resolved from ${
        configuredFile ? "EAS file variable" : "local file"
      }.`,
    );
  } else {
    console.warn(
      "[AirSense config] Android Google Services file is unavailable; native FCM will not work.",
    );
  }
  return config;
};
