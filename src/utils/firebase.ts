import admin from "firebase-admin";

const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
} as admin.ServiceAccount;

if (!serviceAccount.privateKey) {
  throw new Error("Firebase service account is missing in .env");
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export const messaging: admin.messaging.Messaging = admin.messaging();
export const firestore = admin.firestore();
export default admin;
