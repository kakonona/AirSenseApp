import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApp, getApps, initializeApp } from "firebase/app";
import * as FirebaseAuth from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getFirestore } from "firebase/firestore";
import { Platform } from "react-native";

// Salin dari Firebase Console → Project settings → Your apps → (Web app) → SDK setup
const firebaseConfig = {
  apiKey: "AIzaSyA5EEph-u8mPhm_cEavTfD2_YPrxJp5iiU",
  authDomain: "airsense-cp2.firebaseapp.com",
  databaseURL:
    "https://airsense-cp2-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "airsense-cp2",
  storageBucket: "airsense-cp2.firebasestorage.app",
  messagingSenderId: "1024187429583",
  appId: "1:1024187429583:web:6e499fd57df509a046fdba",
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
