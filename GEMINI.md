# Project Rules & Guidelines

## 1. Validation Rule
- **جميع ملفات ومخططات الـ Validation يجب أن توضع حصراً في المجلد `src/validation`** (مثال: `src/validation/admin/...` أو `src/validation/...`).
- يمنع وضع دوال أو مخططات التحقق (Joi / Zod schemas) في ملفات الـ controllers أو الـ helpers أو غيرها.
- كل وحدة أو موديل له ملف validation مستقل داخل `src/validation`.

## 2. Routes & API Workflow Rule
- **عند إنشاء أو استخراج أي APIs**:
  1. يتم إنشاء ملف الـ Routes داخل المجلد المخصص حسب الـ module (مثال: `src/routes/<module>/...` مثل `src/routes/admin/pos/shifts.ts` أو `src/routes/admin/shifts.ts`).
  2. يتم ربط الـ Endpoints مع الـ Controller وتطبيق ميدلوير الـ Validation (`validate(schema)`) من ملف الـ validation المناسب.
  3. يتم تسجيل وتركيب الراوتر في ملف `routes/index.ts` الخاص بالـ module (مثل `src/routes/admin/index.ts`).
