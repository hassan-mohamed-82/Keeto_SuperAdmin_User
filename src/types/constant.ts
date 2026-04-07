export const MODULES = [
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
] as const;

export const ACTION_NAMES = ["View", "Add", "Edit", "Delete", "Status"] as const;

export type ModuleName = (typeof MODULES)[number];
export type ActionName = (typeof ACTION_NAMES)[number];

export const BASE64_IMAGE_REGEX = /^data:image\/(jpeg|jpg|png|gif|webp);base64,/;
