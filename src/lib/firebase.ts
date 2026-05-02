import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const storage = getStorage(app, firebaseConfig.storageBucket);
export const auth = getAuth(app);

let authReadyPromise: Promise<void> | null = null;

export function ensureAnonymousAuth() {
  if (!authReadyPromise) {
    authReadyPromise = (async () => {
      await auth.authStateReady();
      if (!auth.currentUser) {
        try {
          await signInAnonymously(auth);
        } catch (e) {
          console.warn('Anonymous auth failed or restricted:', e);
        }
      }
    })();
  }

  return authReadyPromise;
}

// Critical connection test
async function testConnection() {
  try {
    await ensureAnonymousAuth();
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
void testConnection();
