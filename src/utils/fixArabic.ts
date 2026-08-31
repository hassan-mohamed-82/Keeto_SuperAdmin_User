// @ts-ignore
import factory from 'bidi-js';
// @ts-ignore
import { reshaper } from 'arabic-persian-reshaper';

const bidi = factory();

export function fixArabicText(text: string | null | undefined): string {
    if (!text) return '';
    
    // فحص ما إذا كان النص يحتوي على حروف عربية
    const containsArabic = /[\u0600-\u06FF]/.test(text);
    if (!containsArabic) return text;

    // 1. ربط الحروف العربية ببعضها
    const reshaped = reshaper(text);
    // 2. ضبط اتجاه الكتابة من اليمين لليسار
    const bidiText = bidi.getReorderedString(reshaped, 'ltr');
    
    return bidiText;
}