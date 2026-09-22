"use strict";
/**
 * Arabic Text Processor for PDFKit with OpenType Fonts (e.g. Cairo)
 *
 * Cairo font contains full OpenType GSUB tables for Arabic contextual shaping
 * (init, medi, fina, isol, ligatures like Lam-Alef).
 * In PDFKit's LTR layout, words need their order reversed so that the first word
 * starts on the right, matching natural Arabic RTL reading order.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasArabic = hasArabic;
exports.convertArabicDigitsToWestern = convertArabicDigitsToWestern;
exports.fixArabicText = fixArabicText;
// Check if string contains any Arabic characters
function hasArabic(str) {
    return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(str);
}
// Convert Eastern Arabic numerals to Western digits if needed
const ARABIC_DIGITS_MAP = {
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};
function convertArabicDigitsToWestern(str) {
    return str.replace(/[٠-٩]/g, d => ARABIC_DIGITS_MAP[d] || d);
}
/**
 * Reverses the word order of an Arabic phrase so that PDFKit renders it
 * from right to left while preserving individual word character shaping.
 */
function reverseArabicWords(phrase) {
    const trimmed = phrase.trim();
    if (!hasArabic(trimmed))
        return trimmed;
    // Split words by whitespace
    const words = trimmed.split(/\s+/);
    if (words.length <= 1)
        return trimmed;
    // Reverse word order so PDFKit places the first word on the right
    return words.reverse().join(' ');
}
/**
 * Main export: Prepares Arabic/Mixed text for printing with PDFKit
 */
function fixArabicText(text) {
    if (!text)
        return '';
    const textStr = String(text);
    if (!hasArabic(textStr)) {
        return textStr;
    }
    // Process line by line
    return textStr.split('\n').map(line => {
        // Check if line starts with an LTR English label like "Street: ", "Landmark: ", "Bldg: ", "+ "
        const labelMatch = line.match(/^([A-Za-z0-9\s\#\:\-\+\|\.\,\/]+\:\s*|\s*\+\s*)/);
        if (labelMatch) {
            const prefix = labelMatch[0];
            const rest = line.substring(prefix.length);
            if (hasArabic(rest)) {
                return `${prefix}${reverseArabicWords(rest)}`;
            }
            return line;
        }
        return reverseArabicWords(line);
    }).join('\n');
}
