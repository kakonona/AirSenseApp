import { auth, db, rtdb } from "@/lib/firebase";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  deleteUser,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
  type User,
} from "firebase/auth";
import { getNativeGoogleIdToken } from "@/lib/google-sign-in";
import { ref as dbRef, set } from "firebase/database";
import { doc, getDoc, setDoc } from "firebase/firestore";
import React from "react";
import { Platform } from "react-native";

type AuthContextValue = {
  user: User | null;
  initializing: boolean;
  signIn: (identifier: string, password: string) => Promise<void>;
  signUp: (username: string, email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  resetPassword: (identifier: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;

// Firebase Auth hanya mengenal email. Kalau yang diketik username,
// cari emailnya di koleksi `usernames/{username}`.
async function emailFromIdentifier(identifier: string): Promise<string> {
  const value = identifier.trim();
  if (value.includes("@")) return value;
  const snap = await getDoc(doc(db, "usernames", value.toLowerCase()));
  if (!snap.exists()) throw { code: "auth/user-not-found" };
  return snap.data().email as string;
}

export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Email/username atau password salah";
    case "auth/email-already-in-use":
      return "Email sudah terdaftar";
    case "auth/weak-password":
      return "Kata sandi minimal 6 karakter";
    case "auth/invalid-email":
      return "Format email tidak valid";
    case "auth/too-many-requests":
      return "Terlalu banyak percobaan, coba lagi nanti";
    case "auth/network-request-failed":
      return "Tidak ada koneksi internet";
    case "app/username-taken":
      return "Username sudah dipakai";
    case "app/invalid-username":
      return "Username 3–20 karakter: huruf, angka, titik, atau underscore";
    case "app/google-native-unsupported":
      return "Login Google belum dikonfigurasi untuk aplikasi ini";
    case "app/google-client-id-missing":
      return "Login Google belum dikonfigurasi untuk APK ini. Atur EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID di environment EAS untuk build preview.";
    case "app/google-id-token-missing":
      return "Google tidak memberikan token login. Periksa konfigurasi OAuth.";
    case "ASYNC_OP_IN_PROGRESS":
      return "Proses login Google sedang berjalan";
    case "PLAY_SERVICES_NOT_AVAILABLE":
      return "Google Play Services tidak tersedia atau perlu diperbarui";
    case "10":
    case "DEVELOPER_ERROR":
      return "Konfigurasi Google Sign-In tidak cocok. Periksa package name dan SHA-1.";
    case "12501":
    case "SIGN_IN_CANCELLED":
      return "";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "";
    default:
      console.warn("Auth error:", e);
      return `Terjadi kesalahan (${code || "tanpa kode"}), coba lagi`;
  }
}

async function createDeviceNode(uid: string) {
  await set(dbRef(rtdb, `device/${uid}`), {
    status: "offline",
    threshold_status: "normal",
    aqi: 0,
    pm25: 0,
    co: 0,
    spo2: 0,
    bpm: 0,
    pm10: 0,
  });
}
async function ensureDirectory(u: User) {
  if (!u.email) return;
  const ref = doc(db, "emails", u.email.toLowerCase());
  if ((await getDoc(ref)).exists()) return;
  const prof = await getDoc(doc(db, "profile", u.uid));
  const name =
    (prof.data()?.name as string) || u.displayName || u.email.split("@")[0];
  await setDoc(ref, { uid: u.uid, name });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [initializing, setInitializing] = React.useState(true);

  React.useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u);
        setInitializing(false);
        if (u) ensureDirectory(u).catch(() => {});
      }),
    [],
  );

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user,
      initializing,

      signIn: async (identifier, password) => {
        const email = await emailFromIdentifier(identifier);
        await signInWithEmailAndPassword(auth, email, password);
      },

      signUp: async (username, email, password) => {
        const name = username.trim();
        const key = name.toLowerCase();
        const mail = email.trim();
        if (!USERNAME_RE.test(key)) throw { code: "app/invalid-username" };
        if ((await getDoc(doc(db, "usernames", key))).exists()) {
          throw { code: "app/username-taken" };
        }
        const cred = await createUserWithEmailAndPassword(auth, mail, password);
        try {
          await updateProfile(cred.user, { displayName: name });
          // Sesuai struktur data: profile/{uid} = { name, email }
          await setDoc(doc(db, "profile", cred.user.uid), {
            name,
            email: mail,
          });
          await setDoc(doc(db, "usernames", key), {
            uid: cred.user.uid,
            email: mail,
          });
          await setDoc(doc(db, "emails", mail.toLowerCase()), {
            uid: cred.user.uid,
            name,
          });
        } catch (e) {
          await deleteUser(cred.user).catch(() => {});
          throw e;
        }
      },

      signInWithGoogle: async () => {
        let u: User;
        if (Platform.OS === "web") {
          ({ user: u } = await signInWithPopup(
            auth,
            new GoogleAuthProvider(),
          ));
        } else {
          const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
          if (!webClientId) throw { code: "app/google-client-id-missing" };

          const idToken = await getNativeGoogleIdToken(webClientId);
          if (!idToken) return;
          const credential = GoogleAuthProvider.credential(idToken);
          ({ user: u } = await signInWithCredential(auth, credential));
        }

        const ref = doc(db, "profile", u.uid);
        if (!(await getDoc(ref)).exists()) {
          await setDoc(ref, {
            name: u.displayName ?? "",
            email: u.email ?? "",
          });
        }
      },

      resetPassword: async (identifier) => {
        const email = await emailFromIdentifier(identifier);
        await sendPasswordResetEmail(auth, email);
      },

      signOut: async () => {
        await firebaseSignOut(auth);
      },
    }),
    [user, initializing],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth harus dipakai di dalam <AuthProvider>");
  return ctx;
}
