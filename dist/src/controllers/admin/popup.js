"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePopupStatus = exports.deletePopup = exports.updatePopup = exports.getPopupById = exports.getAllPopups = exports.createPopup = void 0;
const connection_1 = require("../../models/connection");
const popup_1 = require("../../models/schema/admin/popup");
const drizzle_orm_1 = require("drizzle-orm");
const handleImages_1 = require("../../utils/handleImages");
const Errors_1 = require("../../Errors");
const response_1 = require("../../utils/response");
const uuid_1 = require("uuid");
const IMAGE_FOLDER = "popup";
// ─── Create Popup ───
const createPopup = async (req, res) => {
    const { Title, TitleAr, TitleFr, description, descriptionAr, descriptionFr, image, imageAr, imageFr, type, status, startDate, endDate, } = req.body;
    if (!Title || !startDate || !endDate) {
        throw new Errors_1.BadRequest("Title, startDate, and endDate are required");
    }
    let imageUrl = undefined;
    let imageArUrl = undefined;
    let imageFrUrl = undefined;
    if (image) {
        const result = await (0, handleImages_1.saveBase64Image)(req, image, IMAGE_FOLDER);
        imageUrl = result.url;
    }
    if (imageAr) {
        const result = await (0, handleImages_1.saveBase64Image)(req, imageAr, IMAGE_FOLDER);
        imageArUrl = result.url;
    }
    if (imageFr) {
        const result = await (0, handleImages_1.saveBase64Image)(req, imageFr, IMAGE_FOLDER);
        imageFrUrl = result.url;
    }
    const id = (0, uuid_1.v4)();
    await connection_1.db.insert(popup_1.popup).values({
        id,
        Title,
        TitleAr: TitleAr || null,
        TitleFr: TitleFr || null,
        description: description || null,
        descriptionAr: descriptionAr || null,
        descriptionFr: descriptionFr || null,
        image: imageUrl || null,
        imageAr: imageArUrl || null,
        imageFr: imageFrUrl || null,
        type: type || "mykeeto_app",
        status: status || "active",
        startDate: new Date(startDate),
        endDate: new Date(endDate),
    });
    return (0, response_1.SuccessResponse)(res, { message: "Popup created successfully", data: { id } }, 201);
};
exports.createPopup = createPopup;
// ─── Get All Popups ───
const getAllPopups = async (req, res) => {
    const allPopups = await connection_1.db
        .select({
        id: popup_1.popup.id,
        Title: popup_1.popup.Title,
        TitleAr: popup_1.popup.TitleAr,
        TitleFr: popup_1.popup.TitleFr,
        description: popup_1.popup.description,
        descriptionAr: popup_1.popup.descriptionAr,
        descriptionFr: popup_1.popup.descriptionFr,
        image: popup_1.popup.image,
        imageAr: popup_1.popup.imageAr,
        imageFr: popup_1.popup.imageFr,
        type: popup_1.popup.type,
        status: popup_1.popup.status,
        startDate: popup_1.popup.startDate,
        endDate: popup_1.popup.endDate,
        createdAt: popup_1.popup.createdAt,
        updatedAt: popup_1.popup.updatedAt,
    })
        .from(popup_1.popup);
    return (0, response_1.SuccessResponse)(res, { message: "Get all popups success", data: allPopups });
};
exports.getAllPopups = getAllPopups;
// ─── Get Popup By ID ───
const getPopupById = async (req, res) => {
    const { id } = req.params;
    const result = await connection_1.db
        .select({
        id: popup_1.popup.id,
        Title: popup_1.popup.Title,
        TitleAr: popup_1.popup.TitleAr,
        TitleFr: popup_1.popup.TitleFr,
        description: popup_1.popup.description,
        descriptionAr: popup_1.popup.descriptionAr,
        descriptionFr: popup_1.popup.descriptionFr,
        image: popup_1.popup.image,
        imageAr: popup_1.popup.imageAr,
        imageFr: popup_1.popup.imageFr,
        type: popup_1.popup.type,
        status: popup_1.popup.status,
        startDate: popup_1.popup.startDate,
        endDate: popup_1.popup.endDate,
        createdAt: popup_1.popup.createdAt,
        updatedAt: popup_1.popup.updatedAt,
    })
        .from(popup_1.popup)
        .where((0, drizzle_orm_1.eq)(popup_1.popup.id, id))
        .limit(1);
    if (!result[0]) {
        throw new Errors_1.NotFound("Popup not found");
    }
    return (0, response_1.SuccessResponse)(res, { message: "Get popup by id success", data: result[0] });
};
exports.getPopupById = getPopupById;
// ─── Update Popup ───
const updatePopup = async (req, res) => {
    const { id } = req.params;
    const { Title, TitleAr, TitleFr, description, descriptionAr, descriptionFr, image, imageAr, imageFr, type, status, startDate, endDate, } = req.body;
    const existing = await connection_1.db
        .select()
        .from(popup_1.popup)
        .where((0, drizzle_orm_1.eq)(popup_1.popup.id, id))
        .limit(1);
    if (!existing[0]) {
        throw new Errors_1.NotFound("Popup not found");
    }
    const updateData = {
        updatedAt: new Date(),
    };
    if (Title !== undefined)
        updateData.Title = Title;
    if (TitleAr !== undefined)
        updateData.TitleAr = TitleAr;
    if (TitleFr !== undefined)
        updateData.TitleFr = TitleFr;
    if (description !== undefined)
        updateData.description = description;
    if (descriptionAr !== undefined)
        updateData.descriptionAr = descriptionAr;
    if (descriptionFr !== undefined)
        updateData.descriptionFr = descriptionFr;
    if (type !== undefined)
        updateData.type = type;
    if (status !== undefined)
        updateData.status = status;
    if (startDate !== undefined)
        updateData.startDate = new Date(startDate);
    if (endDate !== undefined)
        updateData.endDate = new Date(endDate);
    // Handle images using handleImageUpdate
    if (image !== undefined) {
        updateData.image = await (0, handleImages_1.handleImageUpdate)(req, existing[0].image, image, IMAGE_FOLDER);
    }
    if (imageAr !== undefined) {
        updateData.imageAr = await (0, handleImages_1.handleImageUpdate)(req, existing[0].imageAr, imageAr, IMAGE_FOLDER);
    }
    if (imageFr !== undefined) {
        updateData.imageFr = await (0, handleImages_1.handleImageUpdate)(req, existing[0].imageFr, imageFr, IMAGE_FOLDER);
    }
    if (Object.keys(updateData).length === 1) {
        throw new Errors_1.BadRequest("No data to update");
    }
    await connection_1.db.update(popup_1.popup).set(updateData).where((0, drizzle_orm_1.eq)(popup_1.popup.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Popup updated successfully" });
};
exports.updatePopup = updatePopup;
// ─── Delete Popup ───
const deletePopup = async (req, res) => {
    const { id } = req.params;
    const existing = await connection_1.db
        .select()
        .from(popup_1.popup)
        .where((0, drizzle_orm_1.eq)(popup_1.popup.id, id))
        .limit(1);
    if (!existing[0]) {
        throw new Errors_1.NotFound("Popup not found");
    }
    // Delete associated images
    if (existing[0].image)
        await (0, handleImages_1.deleteImage)(existing[0].image);
    if (existing[0].imageAr)
        await (0, handleImages_1.deleteImage)(existing[0].imageAr);
    if (existing[0].imageFr)
        await (0, handleImages_1.deleteImage)(existing[0].imageFr);
    await connection_1.db.delete(popup_1.popup).where((0, drizzle_orm_1.eq)(popup_1.popup.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Popup deleted successfully" });
};
exports.deletePopup = deletePopup;
// ─── Toggle Popup Status ───
const updatePopupStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!status || !["active", "inactive"].includes(status)) {
        throw new Errors_1.BadRequest("Status must be 'active' or 'inactive'");
    }
    const existing = await connection_1.db
        .select()
        .from(popup_1.popup)
        .where((0, drizzle_orm_1.eq)(popup_1.popup.id, id))
        .limit(1);
    if (!existing[0]) {
        throw new Errors_1.NotFound("Popup not found");
    }
    await connection_1.db.update(popup_1.popup).set({ status }).where((0, drizzle_orm_1.eq)(popup_1.popup.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Popup status updated successfully" });
};
exports.updatePopupStatus = updatePopupStatus;
