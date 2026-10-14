"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyToken = exports.generateDeliveryManToken = exports.generateShippingCompanyToken = exports.generateGuestToken = exports.generateSalesToken = exports.generateRestaurantAdminToken = exports.generateAdminToken = exports.generateUserToken = void 0;
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
// Generate Guest Token
// =======================
const generateGuestToken = (data) => {
    return jsonwebtoken_1.default.sign({
        id: data.id,
        name: "Guest",
        role: "user",
        isGuest: true,
        restaurantId: data.restaurantId || null,
    }, JWT_SECRET, { expiresIn: "30d" });
};
exports.generateGuestToken = generateGuestToken;
// =======================
// Generate Shipping Company Token (User-level per D6)
// =======================
const generateShippingCompanyToken = (data) => {
    return jsonwebtoken_1.default.sign({
        id: data.id,
        name: data.name,
        email: data.email,
        role: "shipping_company",
        type: "shipping_admin",
        shippingCompanyId: data.shippingCompanyId,
        companyRole: data.companyRole || "admin",
        tokenVersion: data.tokenVersion ?? 0,
    }, JWT_SECRET, { expiresIn: "30d" });
};
exports.generateShippingCompanyToken = generateShippingCompanyToken;
// =======================
// Generate Delivery Man Token
// =======================
const generateDeliveryManToken = (data) => {
    return jsonwebtoken_1.default.sign({
        id: data.id,
        name: data.name,
        phone: data.phone || undefined,
        email: data.email || undefined,
        role: "delivery_man",
        type: "delivery_man",
        restaurantId: data.restaurantId || null,
        branchId: data.branchId || null,
        shippingCompanyId: data.shippingCompanyId || null,
        deliveryManId: data.id,
        deliveryType: data.deliveryType || "outsource",
    }, JWT_SECRET, { expiresIn: "30d" });
};
exports.generateDeliveryManToken = generateDeliveryManToken;
// =======================
// Verify Token
// =======================
const verifyToken = (token) => {
    return jsonwebtoken_1.default.verify(token, JWT_SECRET);
};
exports.verifyToken = verifyToken;
