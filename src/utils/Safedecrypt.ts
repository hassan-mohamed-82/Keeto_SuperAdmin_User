import { decryptSecret } from "./encryption";

/**
 * Some restaurant_payment_credentials rows have inconsistent encryption:
 * fields like `apiKey`/`secretKey` are properly AES-encrypted (format
 * "iv:authTag:cipherText", long hex segments joined by colons), but `hmac`
 * on at least one existing row was saved as PLAINTEXT (just the raw ~32-char
 * hex secret Paymob gives you, no colons at all).
 *
 * Calling decryptSecret() on a plaintext value throws, and since that throw
 * happens outside any local try/catch in the webhook handler, it silently
 * aborts the whole request handler before the order ever gets updated —
 * with no clear error surfaced in the logs you're watching.
 *
 * This wrapper detects the shape first and only decrypts values that
 * actually look encrypted, so old inconsistent rows don't crash anything.
 * The real fix is to make sure the credential create/update endpoint always
 * encrypts `hmac` too — this is a defensive stopgap, not a replacement for
 * that fix.
 */
export function safeDecrypt(value: string | undefined | null): string {
    if (!value) return "";

    // Our encryptSecret() output is always "hex:hex:hex" (iv:authTag:data).
    // A raw Paymob HMAC secret or Kashier API key never contains ':'.
    const looksEncrypted = /^[0-9a-fA-F]+:[0-9a-fA-F]+:[0-9a-fA-F]+$/.test(value);

    if (!looksEncrypted) {
        console.warn(
            "[safeDecrypt] Value does not look encrypted (no 'iv:tag:data' format) — using it as-is. " +
            "This credential row needs to be re-saved through an endpoint that encrypts it properly."
        );
        return value;
    }

    try {
        return decryptSecret(value);
    } catch (err) {
        console.error("[safeDecrypt] decryptSecret threw even though the value looked encrypted:", err);
        throw err;
    }
}