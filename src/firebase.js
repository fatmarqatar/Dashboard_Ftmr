// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { getStorage } from 'firebase/storage'
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// IMPORTANT: Prefer Vite environment variables. 
// Create a file named `.env` at project root (same folder as package.json) with:
// VITE_FIREBASE_API_KEY=your_api_key
// VITE_FIREBASE_AUTH_DOMAIN=your_auth_domain
// VITE_FIREBASE_PROJECT_ID=your_project_id
// VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
// VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
// VITE_FIREBASE_APP_ID=your_app_id
//
// Hard-coded fallback values (for reference only; env vars override these):
const HARDCODED_CONFIG = {
  apiKey: "AIzaSyAvvXhD9hhiaojF1WBlUpFDJ0dVjwQcjbc",
  authDomain: "fatmar1-2eb73.firebaseapp.com",
  projectId: "fatmar1-2eb73",
  storageBucket: "fatmar1-2eb73.firebasestorage.app",
  messagingSenderId: "905830696661",
  appId: "1:905830696661:web:03d72cf0c0a966b3ff845c"
}

// Build config from Vite env vars, with fallback to hard-coded values
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || HARDCODED_CONFIG.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || HARDCODED_CONFIG.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || HARDCODED_CONFIG.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || HARDCODED_CONFIG.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || HARDCODED_CONFIG.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || HARDCODED_CONFIG.appId,
}

function createAppIfNeeded() {
  // Avoid multiple initializations in dev/HMR
  if (getApps().length) {
    return getApp()
  }
  return initializeApp(firebaseConfig)
}

const app = createAppIfNeeded()

// Create services
const db = getFirestore(app)
const auth = getAuth(app)
const storage = getStorage(app)

// Helpful debug log (masks API key and shows source)
if (import.meta.env.DEV) {
  try {
    const maskedKey = firebaseConfig.apiKey ? `${firebaseConfig.apiKey.slice(0, 6)}...${firebaseConfig.apiKey.slice(-4)}` : '(none)'
    const apiKeySource = import.meta.env.VITE_FIREBASE_API_KEY ? 'ENV' : 'FALLBACK'
    const projectIdSource = import.meta.env.VITE_FIREBASE_PROJECT_ID ? 'ENV' : 'FALLBACK'
    // eslint-disable-next-line no-console
    console.debug('[firebase] config loaded:', {
      apiKey: `${maskedKey} (from ${apiKeySource})`,
      projectId: `${firebaseConfig.projectId} (from ${projectIdSource})`,
      authDomain: firebaseConfig.authDomain,
    })
  } catch (e) {
    // ignore
  }
}

export function initFirebase() {
  return app
}

export { app, db, auth, storage }