"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteUser = exports.updateUser = exports.getUserById = exports.getAllUsers = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const NotFound_1 = require("../../Errors/NotFound");
const handleImages_1 = require("../../utils/handleImages");
// Get all users
const getAllUsers = async (req, res) => {
    const allUsers = await connection_1.db.select().from(schema_1.users);
    return (0, response_1.SuccessResponse)(res, { message: "Users fetched successfully", data: allUsers }, 200);
};
exports.getAllUsers = getAllUsers;
// Get a single user by ID
const getUserById = async (req, res) => {
    const { id } = req.params;
    const [user] = await connection_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, id)).limit(1);
    if (!user)
        throw new NotFound_1.NotFound("User not found");
    return (0, response_1.SuccessResponse)(res, { message: "User fetched successfully", data: user }, 200);
};
exports.getUserById = getUserById;
// Update user details and status
const updateUser = async (req, res) => {
    const { id } = req.params;
    const { name, phone, status, photo } = req.body;
    const [existingUser] = await connection_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, id)).limit(1);
    if (!existingUser) {
        throw new NotFound_1.NotFound("User not found");
    }
    let photoUrl = existingUser.photo;
    if (photo && photo !== existingUser.photo) {
        if (photo.startsWith("data:image")) {
            photoUrl = await (0, handleImages_1.handleImageUpdate)(req, existingUser.photo, photo, "users");
            // If replacing, you might want to delete the old image using handleImageUpdate if configured
        }
        else {
            photoUrl = photo;
        }
    }
    await connection_1.db.update(schema_1.users)
        .set({
        name: name || existingUser.name,
        phone: phone || existingUser.phone,
        status: status || existingUser.status,
        photo: photoUrl
    })
        .where((0, drizzle_orm_1.eq)(schema_1.users.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "User updated successfully", data: { id } }, 200);
};
exports.updateUser = updateUser;
// Delete a user
const deleteUser = async (req, res) => {
    const { id } = req.params;
    const [existingUser] = await connection_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, id)).limit(1);
    if (!existingUser) {
        throw new NotFound_1.NotFound("User not found");
    }
    await connection_1.db.delete(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "User deleted successfully", data: { id } }, 200);
};
exports.deleteUser = deleteUser;
