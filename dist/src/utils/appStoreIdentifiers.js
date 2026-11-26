"use strict";
// Helpers to read store identifiers from a restaurant's store links.
//   Play Store:  https://play.google.com/store/apps/details?id=com.keeto.pizza  -> "com.keeto.pizza"
//   App Store:   https://apps.apple.com/eg/app/pizza/id6471234567           -> "6471234567"
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidAppleAppId = exports.isValidAndroidPackageName = void 0;
exports.extractAndroidPackageName = extractAndroidPackageName;
exports.extractAppleAppId = extractAppleAppId;
exports.resolveAndroidPackageName = resolveAndroidPackageName;
exports.resolveAppleAppId = resolveAppleAppId;
const PACKAGE_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/;
const APPLE_APP_ID_REGEX = /^\d{6,12}$/;
const isValidAndroidPackageName = (value) => PACKAGE_NAME_REGEX.test(value);
exports.isValidAndroidPackageName = isValidAndroidPackageName;
const isValidAppleAppId = (value) => APPLE_APP_ID_REGEX.test(value);
exports.isValidAppleAppId = isValidAppleAppId;
function extractAndroidPackageName(url) {
    if (!url)
        return null;
    const match = String(url).match(/[?&]id=([a-zA-Z0-9_.]+)/);
    const pkg = match?.[1];
    return pkg && (0, exports.isValidAndroidPackageName)(pkg) ? pkg : null;
}
function extractAppleAppId(url) {
    if (!url)
        return null;
    const match = String(url).match(/\/id(\d{6,12})(?:[/?#]|$)/) ?? String(url).match(/[?&]id=(\d{6,12})/);
    return match?.[1] ?? null;
}
// Explicit column value wins; otherwise fall back to what the store link says.
function resolveAndroidPackageName(r) {
    return r.androidPackageName?.trim() || extractAndroidPackageName(r.androidApp);
}
function resolveAppleAppId(r) {
    return r.appleAppId?.trim() || extractAppleAppId(r.iosApp);
}
