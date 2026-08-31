"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyToken = exports.generateSalesToken = exports.generateRestaurantAdminToken = exports.generateAdminToken = exports.generateUserToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET;
// =======================
// Generate User Token
// =======================
const generateUserToken = (data) => {
    return jsonwebtoken_1.default.sign({
        id: data.id,
        name: data.name,
        role: "user",
        restaurantId: data.restaurantId || null
    }, JWT_SECRET, { expiresIn: "30d" });
};
exports.generateUserToken = generateUserToken;
// =======================
// Generate Admin Token
// =======================
const generateAdminToken = (data) => {
    return jsonwebtoken_1.default.sign({
        id: data.id,
        name: data.name,
        role: "admin",
        type: data.type,
    }, JWT_SECRET, { expiresIn: "7d" });
};
exports.generateAdminToken = generateAdminToken;
// =======================
// Generate Restaurant Admin Token
// =======================
const generateRestaurantAdminToken = (data) => {
    return jsonwebtoken_1.default.sign({
        id: data.id,
        name: data.name,
        role: "restaurant_admin",
        type: data.type,
        restaurantId: data.restaurantId,
        branchId: data.branchId || null,
    }, JWT_SECRET, { expiresIn: "7d" });
};
exports.generateRestaurantAdminToken = generateRestaurantAdminToken;
// =======================
// Generate Sales Token
// =======================
const generateSalesToken = (data) => {
    return jsonwebtoken_1.default.sign({
        id: data.id,
        name: data.name,
        role: "sales",
    }, JWT_SECRET, { expiresIn: "30d" });
};
exports.generateSalesToken = generateSalesToken;
// =======================
// Verify Token
// =======================
const verifyToken = (token) => {
    return jsonwebtoken_1.default.verify(token, JWT_SECRET);
};
exports.verifyToken = verifyToken;
