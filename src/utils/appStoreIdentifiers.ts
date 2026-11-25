// Helpers to read store identifiers from a restaurant's store links.
//   Play Store:  https://play.google.com/store/apps/details?id=com.keeto.pizza  -> "com.keeto.pizza"
//   App Store:   https://apps.apple.com/eg/app/pizza/id6471234567           -> "6471234567"

const PACKAGE_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/;
const APPLE_APP_ID_REGEX = /^\d{6,12}$/;

export const isValidAndroidPackageName = (value: string) => PACKAGE_NAME_REGEX.test(value);
export const isValidAppleAppId = (value: string) => APPLE_APP_ID_REGEX.test(value);

export function extractAndroidPackageName(url?: string | null): string | null {
    if (!url) return null;
    const match = String(url).match(/[?&]id=([a-zA-Z0-9_.]+)/);
    const pkg = match?.[1];
    return pkg && isValidAndroidPackageName(pkg) ? pkg : null;
}

export function extractAppleAppId(url?: string | null): string | null {
    if (!url) return null;
    const match = String(url).match(/\/id(\d{6,12})(?:[/?#]|$)/) ?? String(url).match(/[?&]id=(\d{6,12})/);
    return match?.[1] ?? null;
}

// Explicit column value wins; otherwise fall back to what the store link says.
export function resolveAndroidPackageName(r: { androidPackageName?: string | null; androidApp?: string | null }) {
    return r.androidPackageName?.trim() || extractAndroidPackageName(r.androidApp);
}

export function resolveAppleAppId(r: { appleAppId?: string | null; iosApp?: string | null }) {
    return r.appleAppId?.trim() || extractAppleAppId(r.iosApp);
}
