import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Reemplaza esto con la configuración que te da Firebase
// (Configuración del proyecto > tus apps > SDK de Firebase).
const firebaseConfig = {
  apiKey: "AIzaSyDLAfQQiU9mTcrF5NfkRBbuuwR8jGOx8b4",
  authDomain: "gym-pareja.firebaseapp.com",
  projectId: "gym-pareja",
  storageBucket: "gym-pareja.firebasestorage.app",
  messagingSenderId: "410273806948",
  appId: "1:410273806948:web:675d82a8b83582707a7d71",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
