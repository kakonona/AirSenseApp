export async function getNativeGoogleIdToken(
  _webClientId: string,
): Promise<string | null> {
  throw { code: "app/google-native-unsupported" };
}
