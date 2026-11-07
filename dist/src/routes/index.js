"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const index_1 = __importDefault(require("./admin/index"));
const index_2 = __importDefault(require("./user/index"));
const index_3 = __importDefault(require("./payments/index"));
const index_4 = __importDefault(require("./shipping/index"));
const resolveDomain_1 = __importDefault(require("./resolveDomain"));
const authHandoff_1 = __importDefault(require("./user/authHandoff"));
const route = (0, express_1.Router)();
// Public: no auth required — resolves custom domain → restaurant slug
route.use('/resolve-domain', resolveDomain_1.default);
// Authentication handoff & exchange routes: POST /api/auth/handoff & POST /api/auth/exchange-code
route.use('/auth', authHandoff_1.default);
route.use('/superadmin', index_1.default);
route.use('/user', index_2.default);
route.use('/payments', index_3.default);
route.use('/shipping', index_4.default);
exports.default = route;
