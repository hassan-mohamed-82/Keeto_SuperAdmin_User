// validations/student.validation.ts

import { z } from "zod";

export const studentSchema = z.object({
    firstname: z.string().min(2, "firstname must be at least 2 characters").max(255),
    lastname: z.string().min(2, "lastname must be at least 2 characters").max(255),
    nickname: z.string().min(2, "nickname must be at least 2 characters").max(255),
    email: z.string().email("email is not valid"),
    password: z.string().min(8, "password must be at least 8 characters"),
    phone: z.string().regex(/^01[0125][0-9]{8}$/, "phone number is not valid"),
    category: z.string().uuid("category id is not valid"),
    grade: z.enum(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"], {
        errorMap: () => ({ message: "grade is not valid" })
    }),
    parentphone: z.string().regex(/^01[0125][0-9]{8}$/, "parent phone number is not valid")
});

export const updateStudentSchema = z.object({
    firstname: z.string().min(2, "firstname must be at least 2 characters").max(255).optional(),
    lastname: z.string().min(2, "lastname must be at least 2 characters").max(255).optional(),
    nickname: z.string().min(2, "nickname must be at least 2 characters").max(255).optional(),
    email: z.string().email("email is not valid").optional(),
    phone: z.string().regex(/^01[0125][0-9]{8}$/, "phone number is not valid").optional(),
    category: z.string().uuid("category id is not valid").optional(),
    grade: z.enum(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"], {
        errorMap: () => ({ message: "grade is not valid" })
    }).optional(),
    parentphone: z.string().regex(/^01[0125][0-9]{8}$/, "parent phone number is not valid").optional(),
    oldPassword: z.string().optional(),
    newPassword: z.string().min(8, "password must be at least 8 characters").optional()
}).refine((data) => {
    if (data.newPassword && !data.oldPassword) {
        return false;
    }
    return true;
}, {
    message: "كلمة المرور القديمة مطلوبة لتغيير كلمة المرور",
    path: ["oldPassword"]
});

export const idSchema = z.string().uuid("معرف الطالب غير صالح");

export const idParamsSchema = z.object({
    id: z.string().uuid("معرف الطالب غير صالح"),
});

export const gradeSchema = z.enum(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"], {
    errorMap: () => ({ message: "الصف غير صالح" })
});

export const categoryIdSchema = z.string().uuid("معرف الفئة غير صالح");
