import { getApp, getApps, initializeApp } from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';
import { getFirestore, initializeFirestore } from 'firebase/firestore';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// The Firebase project's settings come from .env.local, which git ignores, so each copy of the
// app chooses its own project. Copy .env.example to .env.local and fill it in from the Firebase
// console (Project settings > General > Your apps). Restart Expo after changing it.
// Each value must be written out in full (process.env.EXPO_PUBLIC_...) for Expo to fill it in.
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
};
// No built-in fallback project: a missing setting stops the app here, rather than quietly
// connecting it to someone else's database.
const missing = Object.entries(firebaseConfig)
  .filter(([key, value]) => key !== 'measurementId' && !value)
  .map(([key]) => key);
if (missing.length) {
  throw new Error(
    `Firebase isn't set up: ${missing.join(', ')} missing. Copy .env.example to .env.local, fill it in, and restart Expo.`,
  );
}
if (__DEV__) console.log(`Firebase project: ${firebaseConfig.projectId}`);
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

function createAuth(): FirebaseAuth.Auth {
  if (Platform.OS === 'web') return FirebaseAuth.getAuth(app);

  // getReactNativePersistence only exists in Firebase's React Native build,
  // so it's looked up at runtime. It keeps people signed in between app launches.
  const getRNPersistence = (FirebaseAuth as any).getReactNativePersistence;
  if (!getRNPersistence) {
    console.warn('Firebase React Native persistence not found. Users will be signed out when the app closes.');
    return FirebaseAuth.getAuth(app);
  }
  try {
    return FirebaseAuth.initializeAuth(app, { persistence: getRNPersistence(AsyncStorage) });
  } catch {
    // initializeAuth throws if it already ran, e.g. after a fast refresh.
    return FirebaseAuth.getAuth(app);
  }
}

export const auth = createAuth();

// Google sign-in in the app (Expo Go and builds). Optional: without it, Google sign-in says it
// isn't set up. Put the Web client ID from the Firebase console in .env.local:
// Authentication > Sign-in method > Google > Web SDK configuration.
export const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
// public/google-auth.html, once deployed. Add this exact address to that client's Authorized redirect
// URIs in Google Cloud console > APIs & Services > Credentials.
export const googleRedirectPage = `https://${firebaseConfig.projectId}.web.app/google-auth.html`;
function createDb() {
  if (Platform.OS === 'web') return getFirestore(app);
  try {
    // React Native can't read Firestore's streaming connection as it arrives, so live updates
    // reached phones late, in bursts. Long polling delivers each change as soon as it happens.
    return initializeFirestore(app, { experimentalForceLongPolling: true });
  } catch {
    // initializeFirestore throws if it already ran, e.g. after a fast refresh.
    return getFirestore(app);
  }
}

export const db = createDb();
