import {
  GoogleSignin,
  isSuccessResponse,
} from "@react-native-google-signin/google-signin";

export async function getNativeGoogleIdToken(
  webClientId: string,
): Promise<string | null> {
  GoogleSignin.configure({ webClientId });
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) return null;
  if (!response.data.idToken) {
    throw { code: "app/google-id-token-missing" };
  }
  return response.data.idToken;
}
