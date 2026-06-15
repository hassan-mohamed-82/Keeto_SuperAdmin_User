"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.login = login;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema"); // لم نعد بحاجة لاستيراد roles هنا للاستعلام
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jwt_1 = require("../../utils/jwt");
async function login(req, res) {
    const { email, password } = req.body;
    if (!email || !password) {
        throw new Errors_1.BadRequest("Email and password are required");
    }
    // 🔥 جلب الأدمن مع تفاصيل الرول في استعلام واحد
    const admin = await connection_1.db.query.admins.findFirst({
        where: (0, drizzle_orm_1.eq)(schema_1.admins.email, email),
        with: {
            role: true, // سيقوم Drizzle بجلب كائن الرول بالكامل تلقائياً
        },
    });
    if (!admin) {
        throw new Errors_1.UnauthorizedError("Invalid Credentials");
    }
    const isPasswordValid = await bcrypt_1.default.compare(password, admin.password);
    if (!isPasswordValid) {
        throw new Errors_1.UnauthorizedError("Invalid Credentials");
    }
    if (admin.status === "inactive") {
        throw new Errors_1.UnauthorizedError("Admin is inactive");
    }
    const tokenPayload = {
        id: admin.id,
        name: admin.name,
        type: admin.type,
    };
    const token = (0, jwt_1.generateAdminToken)(tokenPayload);
    return (0, response_1.SuccessResponse)(res, {
        message: "Admin logged in successfully",
        token,
        admin: {
            name: admin.name,
            email: admin.email,
            phoneNumber: admin.phoneNumber,
            role: admin.role, // كائن الرول جاهز هنا مباشرة
            permissions: admin.permissions,
            status: admin.status,
            type: admin.type
        }
    }, 200);
}
