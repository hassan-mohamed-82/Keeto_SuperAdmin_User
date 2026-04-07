"use strict";
// validations/student.validation.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.categoryIdSchema = exports.gradeSchema = exports.idParamsSchema = exports.idSchema = exports.updateStudentSchema = exports.studentSchema = void 0;
const zod_1 = require("zod");
exports.studentSchema = zod_1.z.object({
    firstname: zod_1.z.string().min(2, "firstname must be at least 2 characters").max(255),
    lastname: zod_1.z.string().min(2, "lastname must be at least 2 characters").max(255),
    nickname: zod_1.z.string().min(2, "nickname must be at least 2 characters").max(255),
    email: zod_1.z.string().email("email is not valid"),
    password: zod_1.z.string().min(8, "password must be at least 8 characters"),
    phone: zod_1.z.string().regex(/^01[0125][0-9]{8}$/, "phone number is not valid"),
    category: zod_1.z.string().uuid("category id is not valid"),
    grade: zod_1.z.enum(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"], {
        errorMap: () => ({ message: "grade is not valid" })
    }),
    parentphone: zod_1.z.string().regex(/^01[0125][0-9]{8}$/, "parent phone number is not valid")
});
exports.updateStudentSchema = zod_1.z.object({
    firstname: zod_1.z.string().min(2, "firstname must be at least 2 characters").max(255).optional(),
    lastname: zod_1.z.string().min(2, "lastname must be at least 2 characters").max(255).optional(),
    nickname: zod_1.z.string().min(2, "nickname must be at least 2 characters").max(255).optional(),
    email: zod_1.z.string().email("email is not valid").optional(),
    phone: zod_1.z.string().regex(/^01[0125][0-9]{8}$/, "phone number is not valid").optional(),
    category: zod_1.z.string().uuid("category id is not valid").optional(),
    grade: zod_1.z.enum(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"], {
        errorMap: () => ({ message: "grade is not valid" })
    }).optional(),
    parentphone: zod_1.z.string().regex(/^01[0125][0-9]{8}$/, "parent phone number is not valid").optional(),
    oldPassword: zod_1.z.string().optional(),
    newPassword: zod_1.z.string().min(8, "password must be at least 8 characters").optional()
}).refine((data) => {
    if (data.newPassword && !data.oldPassword) {
        return false;
    }
    return true;
}, {
    message: "كلمة المرور القديمة مطلوبة لتغيير كلمة المرور",
    path: ["oldPassword"]
});
exports.idSchema = zod_1.z.string().uuid("معرف الطالب غير صالح");
exports.idParamsSchema = zod_1.z.object({
    id: zod_1.z.string().uuid("معرف الطالب غير صالح"),
});
exports.gradeSchema = zod_1.z.enum(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"], {
    errorMap: () => ({ message: "الصف غير صالح" })
});
exports.categoryIdSchema = zod_1.z.string().uuid("معرف الفئة غير صالح");
