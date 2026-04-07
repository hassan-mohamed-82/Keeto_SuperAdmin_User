"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAdminToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
require("dotenv/config");
const JWT_SECRET = process.env.JWT_SECRET;
const generateAdminToken = (data) => {
    const payload = {
        id: data.id,
        name: data.name,
        role: data.role,
        // permissions: data.permissions,
    };
    return jsonwebtoken_1.default.sign(payload, JWT_SECRET, { expiresIn: "7d" });
};
exports.generateAdminToken = generateAdminToken;
