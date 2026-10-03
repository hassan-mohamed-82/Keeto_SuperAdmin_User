"use strict";
// import admin from "firebase-admin";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.firestore = exports.messaging = exports.ADMIN_PROJECT = void 0;
exports.getMessaging = getMessaging;
// const serviceAccount = {
//   projectId: process.env.FIREBASE_PROJECT_ID,
//   clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
//   privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
// } as admin.ServiceAccount;
// if (!serviceAccount.privateKey) {
//   throw new Error("Firebase service account is missing in .env");
// }
// if (!admin.apps.length) {
//   admin.initializeApp({
//     credential: admin.credential.cert(serviceAccount),
//   });
// }
// export const messaging: admin.messaging.Messaging = admin.messaging();
// export const firestore = admin.firestore();
// export default admin;
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
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const PROJECTS = {
    primary: "FIREBASE",
    secondary: "FIREBASE2",
};
// المشروع اللي فيه تطبيقات الأدمن (Android + iOS)
exports.ADMIN_PROJECT = "primary";
function getApp(key) {
    const existing = firebase_admin_1.default.apps.find((a) => a?.name === key);
    if (existing)
        return existing;
    const prefix = PROJECTS[key];
    if (!prefix)
        throw new Error(`Unknown Firebase project key: "${key}"`);
    function cleanKey(rawKey) {
        if (!rawKey)
            return undefined;
        let k = rawKey.trim();
        if (k.endsWith(','))
            k = k.slice(0, -1).trim();
        if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
            k = k.slice(1, -1).trim();
        }
        return k.replace(/\\n/g, "\n");
    }
    const projectId = process.env[`${prefix}_PROJECT_ID`];
    const clientEmail = process.env[`${prefix}_CLIENT_EMAIL`];
    const privateKey = cleanKey(process.env[`${prefix}_PRIVATE_KEY`]);
    if (!projectId || !clientEmail || !privateKey) {
        throw new Error(`Missing env vars for Firebase project "${key}" (${prefix}_*)`);
    }
    return firebase_admin_1.default.initializeApp({ credential: firebase_admin_1.default.credential.cert({ projectId, clientEmail, privateKey }) }, key);
}
function getMessaging(key = "primary") {
    return getApp(key).messaging();
}
// للكود القديم اللي بيستورد messaging مباشرة
exports.messaging = getMessaging("primary");
exports.firestore = getApp("primary").firestore();
exports.default = firebase_admin_1.default;
