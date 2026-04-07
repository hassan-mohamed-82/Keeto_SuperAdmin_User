"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTokenExpiration = exports.isTokenExpiringSoon = exports.decodeToken = exports.refreshToken = exports.extractTokenFromHeader = exports.verifyToken = exports.generateToken = void 0;
const jsonwebtoken_1 = __importStar(require("jsonwebtoken"));
const Errors_1 = require("../Errors");
require("dotenv/config");
// ═══════════════════════════════════════════════════════════════
// ⚙️ CONFIGURATION
// ═══════════════════════════════════════════════════════════════
const JWT_SECRET = process.env.JWT_SECRET;
// Token expiration times
const TOKEN_EXPIRY = {
    admin: '7d',
    teacher: '14d',
    student: '30d',
    parent: '30d',
};
const generateToken = (data) => {
    const payload = {
        id: data.id,
        name: data.name,
        role: data.role,
    };
    const expiresIn = TOKEN_EXPIRY[data.role];
    return jsonwebtoken_1.default.sign(payload, JWT_SECRET, { expiresIn });
};
exports.generateToken = generateToken;
// ═══════════════════════════════════════════════════════════════
// ✅ VERIFY TOKEN
// ═══════════════════════════════════════════════════════════════
const verifyToken = (token) => {
    try {
        return jsonwebtoken_1.default.verify(token, JWT_SECRET);
    }
    catch (error) {
        if (error instanceof jsonwebtoken_1.TokenExpiredError) {
            throw new Errors_1.UnauthorizedError('انتهت صلاحية التوكن، يرجى تسجيل الدخول مجدداً');
        }
        if (error instanceof jsonwebtoken_1.JsonWebTokenError) {
            throw new Errors_1.UnauthorizedError('التوكن غير صالح');
        }
        throw new Errors_1.UnauthorizedError('حدث خطأ في التحقق من التوكن');
    }
};
exports.verifyToken = verifyToken;
// ═══════════════════════════════════════════════════════════════
// 📤 EXTRACT TOKEN FROM HEADER
// ═══════════════════════════════════════════════════════════════
const extractTokenFromHeader = (authHeader) => {
    if (!authHeader) {
        throw new Errors_1.UnauthorizedError('لم يتم توفير التوكن');
    }
    const [bearer, token] = authHeader.split(' ');
    if (bearer !== 'Bearer' || !token) {
        throw new Errors_1.UnauthorizedError('صيغة التوكن غير صحيحة');
    }
    return token;
};
exports.extractTokenFromHeader = extractTokenFromHeader;
// ═══════════════════════════════════════════════════════════════
// 🔄 REFRESH TOKEN
// ═══════════════════════════════════════════════════════════════
const refreshToken = (oldToken) => {
    const decoded = (0, exports.verifyToken)(oldToken);
    // Extract only the payload data (exclude iat, exp)
    const payload = {
        id: decoded.id,
        name: decoded.name,
        role: decoded.role,
    };
    const expiresIn = TOKEN_EXPIRY[payload.role];
    return jsonwebtoken_1.default.sign(payload, JWT_SECRET, { expiresIn });
};
exports.refreshToken = refreshToken;
// ═══════════════════════════════════════════════════════════════
// 🔍 DECODE TOKEN (WITHOUT VERIFICATION)
// ═══════════════════════════════════════════════════════════════
const decodeToken = (token) => {
    try {
        return jsonwebtoken_1.default.decode(token);
    }
    catch {
        return null;
    }
};
exports.decodeToken = decodeToken;
// ═══════════════════════════════════════════════════════════════
// ⏰ CHECK IF TOKEN IS EXPIRING SOON
// ═══════════════════════════════════════════════════════════════
const isTokenExpiringSoon = (token, thresholdHours = 24) => {
    try {
        const decoded = jsonwebtoken_1.default.decode(token);
        if (!decoded?.exp)
            return false;
        const expirationTime = decoded.exp * 1000; // Convert to milliseconds
        const currentTime = Date.now();
        const thresholdMs = thresholdHours * 60 * 60 * 1000;
        return expirationTime - currentTime < thresholdMs;
    }
    catch {
        return false;
    }
};
exports.isTokenExpiringSoon = isTokenExpiringSoon;
// ═══════════════════════════════════════════════════════════════
// 📊 GET TOKEN EXPIRATION DATE
// ═══════════════════════════════════════════════════════════════
const getTokenExpiration = (token) => {
    try {
        const decoded = jsonwebtoken_1.default.decode(token);
        if (!decoded?.exp)
            return null;
        return new Date(decoded.exp * 1000);
    }
    catch {
        return null;
    }
};
exports.getTokenExpiration = getTokenExpiration;
