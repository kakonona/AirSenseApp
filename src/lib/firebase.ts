import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApp, getApps, initializeApp } from "firebase/app";
import * as FirebaseAuth from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getFirestore } from "firebase/firestore";
import { Platform } from "react-native";

// Salin dari Firebase Console → Project settings → Your apps → (Web app) → SDK setup
const firebaseConfig = {
  apiKey: "AIzaSyDJdsSOlalzyAjT8HAMJotxiCS65I0K7Kk",
  authDomain: "airsensecp1.firebaseapp.com",
  databaseURL:
    "https://airsensecp1-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "airsensecp1",
  storageBucket: "airsensecp1.firebasestorage.app",
  messagingSenderId: "128083387722",
  appId: "1:128083387722:web:b90a97a147cacb7d284db3",
  measurementId: "G-40NXL7DX97",
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

function createAuth(): FirebaseAuth.Auth {
  if (Platform.OS === "web") return FirebaseAuth.getAuth(app);

  // Native: simpan sesi login di AsyncStorage supaya tidak logout tiap app ditutup.
  // Pakai `any` karena tipe getReactNativePersistence berbeda-beda antar versi firebase.
  const FA = FirebaseAuth as any;
  try {
    const persistence = FA.getReactNativePersistence
      ? FA.getReactNativePersistence(AsyncStorage)
      : FA.reactNativeLocalPersistence;
    return FA.initializeAuth(app, { persistence });
  } catch {
    // Hot reload: auth sudah pernah diinisialisasi
    return FirebaseAuth.getAuth(app);
  }
}

export const auth = createAuth();
export const db = getFirestore(app);
export const rtdb = getDatabase(app);
