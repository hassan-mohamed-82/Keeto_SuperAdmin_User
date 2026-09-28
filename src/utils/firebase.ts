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


// import admin from "firebase-admin";

// export type FirebaseProjectKey = "primary" | "secondary";

// function buildCredential(envPrefix: string): admin.ServiceAccount {
//     const projectId = process.env[`${envPrefix}_PROJECT_ID`];
//     const clientEmail = process.env[`${envPrefix}_CLIENT_EMAIL`];
//     const privateKey = process.env[`${envPrefix}_PRIVATE_KEY`]?.replace(/\\n/g, "\n");

//     if (!projectId || !clientEmail || !privateKey) {
//         throw new Error(`Firebase service account env vars are missing for prefix "${envPrefix}" (expected ${envPrefix}_PROJECT_ID, ${envPrefix}_CLIENT_EMAIL, ${envPrefix}_PRIVATE_KEY).`);
//     }

//     return { projectId, clientEmail, privateKey };
// }

// function getOrCreateApp(name: string, envPrefix: string): admin.app.App {
//     const existing = admin.apps.find((a) => a?.name === name);
//     if (existing) return existing;

//     return admin.initializeApp(
//         { credential: admin.credential.cert(buildCredential(envPrefix)) },
//         name
//     );
// }

// // Primary project is REQUIRED (this is your original/old Firebase project —
// // FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY).
// const primaryApp = getOrCreateApp("primary", "FIREBASE");

// // Secondary project is OPTIONAL — only initialized if FIREBASE2_PROJECT_ID is
// // set, so this doesn't break setups that only ever had one Firebase project.
// const secondaryApp: admin.app.App | null = process.env.FIREBASE2_PROJECT_ID
//     ? getOrCreateApp("secondary", "FIREBASE2")
//     : null;

// if (!secondaryApp) {
//     console.warn(
//         "[Firebase] Secondary project not configured (FIREBASE2_PROJECT_ID missing). " +
//         "Notifications for restaurants assigned to the secondary project will fall back to the primary project and likely fail silently (wrong project's tokens)."
//     );
// }

// /**
//  * Returns the Messaging instance for the given Firebase project key.
//  * Defaults to "primary" when no project is specified or the secondary
//  * project isn't configured.
//  */
// export function getMessaging(project: FirebaseProjectKey = "primary"): admin.messaging.Messaging {
//     if (project === "secondary" && secondaryApp) {
//         return secondaryApp.messaging();
//     }
//     return primaryApp.messaging();
// }

// /**
//  * Returns the Firestore instance for the given Firebase project key, if you
//  * ever need per-project Firestore access too. Same fallback behavior as
//  * getMessaging.
//  */
// export function getFirestore(project: FirebaseProjectKey = "primary"): admin.firestore.Firestore {
//     if (project === "secondary" && secondaryApp) {
//         return secondaryApp.firestore();
//     }
//     return primaryApp.firestore();
// }

// // Backward-compatible exports — anything that used to import `messaging` /
// // `firestore` directly keeps working exactly as before, always pointing at
// // the primary project.
// export const messaging: admin.messaging.Messaging = primaryApp.messaging();
// export const firestore: admin.firestore.Firestore = primaryApp.firestore();

// export default admin;