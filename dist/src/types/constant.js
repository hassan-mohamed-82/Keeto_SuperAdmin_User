"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BASE64_IMAGE_REGEX = exports.ACTION_NAMES = exports.MODULES = void 0;
exports.MODULES = [
    "admins",
    "roles",
    "courses",
    "lessons",
    "chapters",
    "questions",
    "answers",
    "users",
    "payments",
    "subscriptions",
    "payment_methods",
    "promocodes",
];
exports.ACTION_NAMES = ["View", "Add", "Edit", "Delete", "Status"];
exports.BASE64_IMAGE_REGEX = /^data:image\/(jpeg|jpg|png|gif|webp);base64,/;
