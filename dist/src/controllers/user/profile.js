"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteAccount = exports.changepassword = exports.updateProfile = exports.getRestaurantPoints = exports.getProfile = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const bcrypt_1 = __importDefault(require("bcrypt"));
const getProfile = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user?.id || req.user?._id;
    const restaurantId = req.query?.restaurantId;
    // 1. Fetch User Profile Info
    const [userInfo] = await connection_1.db
        .select({
        id: schema_1.users.id,
        name: schema_1.users.name,
        email: schema_1.users.email,
        phone: schema_1.users.phone,
        alternatePhone: schema_1.users.alternatePhone,
        photo: schema_1.users.photo,
        isVerified: schema_1.users.isVerified,
        isProfileComplete: schema_1.users.isProfileComplete,
        createdAt: schema_1.users.createdAt,
    })
        .from(schema_1.users)
        .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId))
        .limit(1);
    if (!userInfo) {
        throw new Errors_1.NotFound("User not found");
    }
    // 2. Fetch All Addresses for this User
    const userAddresses = await connection_1.db
        .select({
        id: schema_1.addresses.id,
        zoneId: schema_1.addresses.zoneId,
        type: schema_1.addresses.type,
        title: schema_1.addresses.title,
        lat: schema_1.addresses.lat,
        lng: schema_1.addresses.lng,
        street: schema_1.addresses.street,
        number: schema_1.addresses.number,
        floor: schema_1.addresses.floor,
        apartment: schema_1.addresses.apartment,
        landmark: schema_1.addresses.landmark,
        location: schema_1.addresses.location,
        fulladdress: schema_1.addresses.fulladdress,
        zone: {
            id: schema_1.zones.id,
            name: schema_1.zones.name,
            nameAr: schema_1.zones.nameAr,
            nameFr: schema_1.zones.nameFr,
            displayName: schema_1.zones.displayName,
            displayNameAr: schema_1.zones.displayNameAr,
            displayNameFr: schema_1.zones.displayNameFr,
        },
        city: {
            id: schema_1.cities.id,
            name: schema_1.cities.name,
            nameAr: schema_1.cities.nameAr,
            nameFr: schema_1.cities.nameFr,
        }
    })
        .from(schema_1.addresses)
        .leftJoin(schema_1.zones, (0, drizzle_orm_1.eq)(schema_1.addresses.zoneId, schema_1.zones.id))
        .leftJoin(schema_1.cities, (0, drizzle_orm_1.eq)(schema_1.zones.cityId, schema_1.cities.id))
        .where((0, drizzle_orm_1.eq)(schema_1.addresses.userId, userId));
    // 3. Fetch Orders Count (scoped to a restaurant if restaurantId query param is provided)
    const ordersCountCondition = restaurantId
        ? (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.userId, userId), (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId))
        : (0, drizzle_orm_1.eq)(schema_1.orders.userId, userId);
    const [ordersCount] = await connection_1.db
        .select({ count: (0, drizzle_orm_1.sql) `COUNT(*)` })
        .from(schema_1.orders)
        .where(ordersCountCondition);
    // 4. Fetch User Wallet Balance
    const [wallet] = await connection_1.db
        .select({
        balance: schema_1.userWallets.balance,
    })
        .from(schema_1.userWallets)
        .where((0, drizzle_orm_1.eq)(schema_1.userWallets.userId, userId))
        .limit(1);
    // const userPoints = await db
    //     .select({
    //         restaurantId: userRestaurantPoints.restaurantId,
    //         restaurantName: restaurants.name,
    //         points: userRestaurantPoints.points
    //     })
    //     .from(userRestaurantPoints)
    //     .leftJoin(restaurants, eq(restaurants.id, userRestaurantPoints.restaurantId))
    //     .where(eq(userRestaurantPoints.userId, userId));
    const isProfileComplete = userInfo.isProfileComplete || !(userInfo.email && userInfo.email.endsWith("@privaterelay.appleid.com"));
    return (0, response_1.SuccessResponse)(res, {
        data: {
            user: {
                id: userInfo.id,
                name: userInfo.name,
                email: userInfo.email,
                phone: userInfo.phone,
                photo: userInfo.photo,
                alternatePhone: userInfo.alternatePhone,
                isVerified: userInfo.isVerified,
                createdAt: userInfo.createdAt,
                isProfileComplete,
                addresses: userAddresses,
            },
            walletBalance: wallet?.balance || "0.00",
            ordersCount: Number(ordersCount?.count || 0),
            // restaurantPoints: userPoints
        },
    });
};
exports.getProfile = getProfile;
// ==========================================
// Get User Points for a Specific Restaurant
// ==========================================
const getRestaurantPoints = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user?.id || req.user?._id;
    const { restaurantId } = req.params;
    if (!restaurantId)
        throw new Errors_1.BadRequest("restaurantId is required");
    const [pointsRecord] = await connection_1.db
        .select({
        restaurantId: schema_1.userRestaurantPoints.restaurantId,
        restaurantName: schema_1.restaurants.name,
        points: schema_1.userRestaurantPoints.points,
        updatedAt: schema_1.userRestaurantPoints.updatedAt,
    })
        .from(schema_1.userRestaurantPoints)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.restaurants.id, schema_1.userRestaurantPoints.restaurantId))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userRestaurantPoints.userId, userId), (0, drizzle_orm_1.eq)(schema_1.userRestaurantPoints.restaurantId, restaurantId)))
        .limit(1);
    return (0, response_1.SuccessResponse)(res, {
        data: {
            restaurantId,
            restaurantName: pointsRecord?.restaurantName || null,
            points: pointsRecord?.points || 0,
            updatedAt: pointsRecord?.updatedAt || null,
        }
    });
};
exports.getRestaurantPoints = getRestaurantPoints;
const updateProfile = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user?.id || req.user?._id;
    const { name, phone, email, photo, alternatePhone } = req.body;
    const isProfileComplete = !(email && email.endsWith("@privaterelay.appleid.com"));
    await connection_1.db.update(schema_1.users)
        .set({ name, phone, email, photo, alternatePhone, isProfileComplete })
        .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
    return (0, response_1.SuccessResponse)(res, { message: "Profile updated successfully", data: { isProfileComplete } });
};
exports.updateProfile = updateProfile;
const changepassword = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user?.id || req.user?._id;
    const { oldPassword, newPassword } = req.body;
    if (!userId) {
        throw new Errors_1.UnauthorizedError("Unauthorized");
    }
    if (!oldPassword || !newPassword) {
        throw new Errors_1.BadRequest("Old password and new password are required");
    }
    const [user] = await connection_1.db
        .select()
        .from(schema_1.users)
        .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId))
        .limit(1);
    if (!user) {
        throw new Errors_1.NotFound("Admin profile not found");
    }
    if (!user.password) {
        throw new Errors_1.BadRequest("Cannot change password for this account");
    }
    const passwordMatch = await bcrypt_1.default.compare(oldPassword, user.password);
    if (!passwordMatch) {
        throw new Errors_1.BadRequest("Invalid old password");
    }
    const salt = await bcrypt_1.default.genSalt(10);
    const hashedPassword = await bcrypt_1.default.hash(newPassword, salt);
    await connection_1.db
        .update(schema_1.users)
        .set({ password: hashedPassword })
        .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
    return (0, response_1.SuccessResponse)(res, { message: "Password changed successfully" });
};
exports.changepassword = changepassword;
// ==========================================
// Delete Account (Soft Delete)
// ==========================================
const deleteAccount = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
        throw new Errors_1.UnauthorizedError("Unauthorized");
    }
    const [user] = await connection_1.db
        .select()
        .from(schema_1.users)
        .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId))
        .limit(1);
    if (!user) {
        throw new Errors_1.NotFound("User not found");
    }
    if (user.isDeleted) {
        throw new Errors_1.BadRequest("Account is already deleted");
    }
    // Soft delete the user
    await connection_1.db.update(schema_1.users)
        .set({
        isDeleted: true,
        deletedAt: new Date()
    })
        .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
    return (0, response_1.SuccessResponse)(res, { message: "Account deleted successfully" });
};
exports.deleteAccount = deleteAccount;
