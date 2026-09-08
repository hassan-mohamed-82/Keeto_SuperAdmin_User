# Project Rules & Guidelines

## Validation Rule
- **جميع ملفات الـ Validation يجب أن توضع حصراً في المجلد `src/validation`** (مثال: `src/validation/admin/...` أو `src/validation/...`).
- يمنع وضع دوال أو مخططات التحقق (Joi schemas / validations) في ملفات الـ controllers أو الـ helpers أو غيرها.
- كل وحدة أو موديل له ملف validation مستقل داخل `src/validation`.
