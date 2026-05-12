"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPopupById = exports.getActivePopups = void 0;
const connection_1 = require("../../models/connection");
const popup_1 = require("../../models/schema/admin/popup");
const drizzle_orm_1 = require("drizzle-orm");
const Errors_1 = require("../../Errors");
const response_1 = require("../../utils/response");
// ─── Get All Active Popups (filtered by date and status) ───
const getActivePopups = async (req, res) => {
    const now = new Date();
    const activePopups = await connection_1.db
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
        startDate: popup_1.popup.startDate,
        endDate: popup_1.popup.endDate,
    })
        .from(popup_1.popup)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(popup_1.popup.status, "active"), (0, drizzle_orm_1.lte)(popup_1.popup.startDate, now), (0, drizzle_orm_1.gte)(popup_1.popup.endDate, now)));
    return (0, response_1.SuccessResponse)(res, { message: "Get active popups success", data: activePopups });
};
exports.getActivePopups = getActivePopups;
// ─── Get Active Popup By ID ───
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
        startDate: popup_1.popup.startDate,
        endDate: popup_1.popup.endDate,
    })
        .from(popup_1.popup)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(popup_1.popup.id, id), (0, drizzle_orm_1.eq)(popup_1.popup.status, "active")))
        .limit(1);
    if (!result[0]) {
        throw new Errors_1.NotFound("Popup not found");
    }
    return (0, response_1.SuccessResponse)(res, { message: "Get popup by id success", data: result[0] });
};
exports.getPopupById = getPopupById;
