"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseJsonArray = exports.roundMoney = void 0;
const roundMoney = (amount) => Math.round(amount * 100) / 100;
exports.roundMoney = roundMoney;
const parseJsonArray = (val) => {
    if (!val)
        return [];
    if (typeof val === "string") {
        try {
            const parsed = JSON.parse(val);
            return typeof parsed === "string" ? JSON.parse(parsed) : (Array.isArray(parsed) ? parsed : []);
        }
        catch {
            return [];
        }
    }
    return Array.isArray(val) ? val : [];
};
exports.parseJsonArray = parseJsonArray;
