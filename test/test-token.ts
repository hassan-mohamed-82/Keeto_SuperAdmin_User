import 'dotenv/config';
import * as admin from 'firebase-admin';

// 1. Primary Service Account Configuration
const primaryServiceAccount: admin.ServiceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
};

// 2. Secondary Service Account Configuration
const secondaryServiceAccount: admin.ServiceAccount = {
  projectId: process.env.FIREBASE2_PROJECT_ID,
  privateKey: process.env.FIREBASE2_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  clientEmail: process.env.FIREBASE2_CLIENT_EMAIL,
};

// 3. Initialize Firebase Apps
const primaryApp = admin.initializeApp(
  { credential: admin.credential.cert(primaryServiceAccount) },
  'primary'
);

const secondaryApp = admin.initializeApp(
  { credential: admin.credential.cert(secondaryServiceAccount) },
  'secondary'
);

// FCM Token to test
const tokenToTest = 'copmOYf-rUmgsgFcVFdSCC:APA91bHrfffHKuXVIVTZ1M0-pKK9kqCv033RMiBXyKKK2udDnb73G6rGZS0KPP9pZ93B2f00OCDcHsfNVk_4Kp2ezorC0UgpFCVP_psowg33zSNvikaft5A';

async function testTokenLocally(): Promise<void> {
  const message: admin.messaging.Message = {
    notification: { title: 'Test', body: 'Local Test' },
    token: tokenToTest,
  };

  console.log('Testing on PRIMARY project...');
  try {
    await primaryApp.messaging().send(message, true); // dryRun = true
    console.log('✅ Success on PRIMARY! This token belongs here.');
  } catch (error: any) {
    console.error('❌ Failed on PRIMARY.');
    console.error(`--> Error Code: ${error?.code || error?.message}`);
  }

  console.log('\n------------------\n');

  console.log('Testing on SECONDARY project...');
  try {
    await secondaryApp.messaging().send(message, true); // dryRun = true
    console.log('✅ Success on SECONDARY! This token belongs here.');
  } catch (error: any) {
    console.error('❌ Failed on SECONDARY.');
    console.error(`--> Error Code: ${error?.code || error?.message}`);
  }
}

testTokenLocally();