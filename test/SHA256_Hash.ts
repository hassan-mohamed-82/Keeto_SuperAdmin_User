import crypto from 'crypto';

const password = process.argv[2] || 'password';

const salt = crypto.randomBytes(24).toString('base64');
const iterations = 1000;
const keylen = 24;
const digest = 'sha256';

const hash = crypto.pbkdf2Sync(password, salt, iterations, keylen, digest).toString('base64');

const formattedPassword = `sha256:${iterations}:${salt}:${hash}`;

console.log(`Password: ${password}`);
console.log(`Formatted: ${formattedPassword}`);
