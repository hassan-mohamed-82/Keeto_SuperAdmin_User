"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const kashierpayment_1 = __importDefault(require("./kashierpayment"));
const route = (0, express_1.Router)();
route.use('/kashier', kashierpayment_1.default);
exports.default = route;
