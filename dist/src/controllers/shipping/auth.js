"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.login = login;
exports.getProfile = getProfile;
exports.updateProfile = updateProfile;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jwt_1 = require("../../utils/jwt");
async function login(req, res) {
    const { email, password } = req.body;
    const companyList = await connection_1.db
        .select()
        .from(schema_1.shippingCompanies)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.email, email))
        .limit(1);
    if (companyList.length === 0) {
        throw new Errors_1.UnauthorizedError("Invalid credentials");
    }
    const company = companyList[0];
    const isPasswordValid = await bcrypt_1.default.compare(password, company.password);
    if (!isPasswordValid) {
        throw new Errors_1.UnauthorizedError("Invalid credentials");
    }
    if (company.status === "inactive") {
        throw new Errors_1.UnauthorizedError("Shipping company account is inactive. Please contact system admin.");
    }
    const token = (0, jwt_1.generateShippingCompanyToken)({
        id: company.id,
        name: company.name,
        email: company.email,
    });
    const { password: _, ...companyData } = company;
    return (0, response_1.SuccessResponse)(res, {
        message: "Logged in successfully",
        token,
        company: companyData,
    });
}
async function getProfile(req, res) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const companyList = await connection_1.db
        .select()
        .from(schema_1.shippingCompanies)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.id, companyId))
        .limit(1);
    if (companyList.length === 0) {
        throw new Errors_1.NotFound("Shipping company not found");
    }
    const { password: _, ...companyData } = companyList[0];
    return (0, response_1.SuccessResponse)(res, {
        message: "Profile retrieved successfully",
        data: companyData,
    });
}
async function updateProfile(req, res) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const { name, nameAr, phone, address, logo, password } = req.body;
    const updateData = {};
    if (name !== undefined)
        updateData.name = name;
    if (nameAr !== undefined)
        updateData.nameAr = nameAr;
    if (phone !== undefined)
        updateData.phone = phone;
    if (address !== undefined)
        updateData.address = address;
    if (logo !== undefined)
        updateData.logo = logo;
    if (password) {
        updateData.password = await bcrypt_1.default.hash(password, 10);
    }
    await connection_1.db
        .update(schema_1.shippingCompanies)
        .set(updateData)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.id, companyId));
    return (0, response_1.SuccessResponse)(res, {
        message: "Profile updated successfully",
    });
}
