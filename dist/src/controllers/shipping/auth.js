"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCourierProfile = exports.getMyUserProfile = exports.getProfile = exports.courierLogin = exports.login = void 0;
exports.updateProfile = updateProfile;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jwt_1 = require("../../utils/jwt");
const catchAsync_1 = require("../../utils/catchAsync");
// =========================================================================
// 1. Login via shipping_company_users (D6)
// =========================================================================
exports.login = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        throw new Errors_1.BadRequest("Email and password are required");
    }
    const userList = await connection_1.db
        .select({
        id: schema_1.shippingCompanyUsers.id,
        shippingCompanyId: schema_1.shippingCompanyUsers.shippingCompanyId,
        name: schema_1.shippingCompanyUsers.name,
        email: schema_1.shippingCompanyUsers.email,
        password: schema_1.shippingCompanyUsers.password,
        role: schema_1.shippingCompanyUsers.role,
        status: schema_1.shippingCompanyUsers.status,
        tokenVersion: schema_1.shippingCompanyUsers.tokenVersion,
        companyName: schema_1.shippingCompanies.name,
        companyStatus: schema_1.shippingCompanies.status,
    })
        .from(schema_1.shippingCompanyUsers)
        .innerJoin(schema_1.shippingCompanies, (0, drizzle_orm_1.eq)(schema_1.shippingCompanyUsers.shippingCompanyId, schema_1.shippingCompanies.id))
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanyUsers.email, email))
        .limit(1);
    if (userList.length === 0) {
        throw new Errors_1.UnauthorizedError("Invalid credentials");
    }
    const user = userList[0];
    const isPasswordValid = await bcrypt_1.default.compare(password, user.password);
    if (!isPasswordValid) {
        throw new Errors_1.UnauthorizedError("Invalid credentials");
    }
    if (user.status !== "active") {
        throw new Errors_1.UnauthorizedError("Your account is inactive. Please contact your administrator.");
    }
    if (user.companyStatus !== "active") {
        throw new Errors_1.UnauthorizedError("Shipping company account is inactive. Please contact system admin.");
    }
    // D6: JWT carries id=user.id, shippingCompanyId=company.id, role=shipping_company, companyRole
    const token = (0, jwt_1.generateShippingCompanyToken)({
        id: user.id,
        shippingCompanyId: user.shippingCompanyId,
        name: user.name,
        email: user.email,
        companyRole: user.role,
        tokenVersion: user.tokenVersion,
    });
    return (0, response_1.SuccessResponse)(res, {
        message: "Logged in successfully",
        token,
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            shippingCompanyId: user.shippingCompanyId,
            companyName: user.companyName,
        },
    });
});
// =========================================================================
// 2. Courier login (delivery_man role)
// =========================================================================
exports.courierLogin = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const { phone, password } = req.body;
    if (!phone || !password) {
        throw new Errors_1.BadRequest("Phone and password are required");
    }
    const dmList = await connection_1.db
        .select()
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.deliveryMen.phone, phone), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.isDeleted, false)))
        .limit(1);
    if (dmList.length === 0) {
        throw new Errors_1.UnauthorizedError("Invalid credentials");
    }
    const dm = dmList[0];
    if (!dm.password) {
        throw new Errors_1.UnauthorizedError("Account has no password set. Please contact your company.");
    }
    const isPasswordValid = await bcrypt_1.default.compare(password, dm.password);
    if (!isPasswordValid) {
        throw new Errors_1.UnauthorizedError("Invalid credentials");
    }
    if (!dm.isActive) {
        throw new Errors_1.UnauthorizedError("Your courier account is inactive.");
    }
    if (!dm.shippingCompanyId) {
        throw new Errors_1.UnauthorizedError("Courier is not assigned to a shipping company.");
    }
    const token = (0, jwt_1.generateDeliveryManToken)({
        id: dm.id,
        name: dm.name,
        phone: dm.phone,
        email: dm.email ?? undefined,
        shippingCompanyId: dm.shippingCompanyId,
        restaurantId: dm.restaurantId,
        branchId: dm.branchId,
        deliveryType: dm.deliveryType,
    });
    const { password: _, ...dmData } = dm;
    return (0, response_1.SuccessResponse)(res, {
        message: "Courier logged in successfully",
        token,
        courier: dmData,
    });
});
// =========================================================================
// 3. Get Company Profile (for shipping company users)
// =========================================================================
exports.getProfile = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const companyList = await connection_1.db
        .select({
        id: schema_1.shippingCompanies.id,
        name: schema_1.shippingCompanies.name,
        nameAr: schema_1.shippingCompanies.nameAr,
        phone: schema_1.shippingCompanies.phone,
        email: schema_1.shippingCompanies.email,
        address: schema_1.shippingCompanies.address,
        logo: schema_1.shippingCompanies.logo,
        maxSearchRadius: schema_1.shippingCompanies.maxSearchRadius,
        maxActiveOrders: schema_1.shippingCompanies.maxActiveOrders,
        maxAttempts: schema_1.shippingCompanies.maxAttempts,
        commissionType: schema_1.shippingCompanies.commissionType,
        commissionValue: schema_1.shippingCompanies.commissionValue,
        status: schema_1.shippingCompanies.status,
        createdAt: schema_1.shippingCompanies.createdAt,
        updatedAt: schema_1.shippingCompanies.updatedAt,
    })
        .from(schema_1.shippingCompanies)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.id, companyId))
        .limit(1);
    if (companyList.length === 0) {
        throw new Errors_1.NotFound("Shipping company not found");
    }
    return (0, response_1.SuccessResponse)(res, {
        message: "Profile retrieved successfully",
        data: companyList[0],
    });
});
// =========================================================================
// 4. Get Current User Profile
// =========================================================================
exports.getMyUserProfile = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const userList = await connection_1.db
        .select({
        id: schema_1.shippingCompanyUsers.id,
        name: schema_1.shippingCompanyUsers.name,
        email: schema_1.shippingCompanyUsers.email,
        phone: schema_1.shippingCompanyUsers.phone,
        role: schema_1.shippingCompanyUsers.role,
        status: schema_1.shippingCompanyUsers.status,
        shippingCompanyId: schema_1.shippingCompanyUsers.shippingCompanyId,
        createdAt: schema_1.shippingCompanyUsers.createdAt,
    })
        .from(schema_1.shippingCompanyUsers)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanyUsers.id, userId))
        .limit(1);
    if (userList.length === 0) {
        throw new Errors_1.NotFound("User not found");
    }
    return (0, response_1.SuccessResponse)(res, {
        message: "User profile retrieved successfully",
        data: userList[0],
    });
});
// =========================================================================
// 5. Get Courier Profile (delivery_man)
// =========================================================================
exports.getCourierProfile = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const courierId = req.user?.deliveryManId || req.user?.id;
    if (!courierId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const [dm] = await connection_1.db
        .select({
        id: schema_1.deliveryMen.id,
        name: schema_1.deliveryMen.name,
        phone: schema_1.deliveryMen.phone,
        email: schema_1.deliveryMen.email,
        image: schema_1.deliveryMen.image,
        deliveryType: schema_1.deliveryMen.deliveryType,
        allZones: schema_1.deliveryMen.allZones,
        shiftStatus: schema_1.deliveryMen.shiftStatus,
        isOnline: schema_1.deliveryMen.isOnline,
        isAvailable: schema_1.deliveryMen.isAvailable,
        activeOrdersCount: schema_1.deliveryMen.activeOrdersCount,
        currentLat: schema_1.deliveryMen.currentLat,
        currentLng: schema_1.deliveryMen.currentLng,
        shippingCompanyId: schema_1.deliveryMen.shippingCompanyId,
        createdAt: schema_1.deliveryMen.createdAt,
    })
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, courierId))
        .limit(1);
    if (!dm) {
        throw new Errors_1.NotFound("Courier not found");
    }
    return (0, response_1.SuccessResponse)(res, {
        message: "Courier profile retrieved successfully",
        data: dm,
    });
});
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
