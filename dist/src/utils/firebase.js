"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.firestore = exports.messaging = void 0;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
};
if (!serviceAccount.privateKey) {
    throw new Error("Firebase service account is missing in .env");
}
if (!firebase_admin_1.default.apps.length) {
    firebase_admin_1.default.initializeApp({
        credential: firebase_admin_1.default.credential.cert(serviceAccount),
    });
}
exports.messaging = firebase_admin_1.default.messaging();
exports.firestore = firebase_admin_1.default.firestore();
exports.default = firebase_admin_1.default;
