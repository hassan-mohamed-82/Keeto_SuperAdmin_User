
export const MODULES = [
    "Admins",
    "Roles",
    "Countries",
    "Cities",
    "Zones",
    "ZoneDeliveryFees",
    "Restaurants",
    "RestaurantWallets",
    "RestaurantWalletTransactions",
    "Food",
    "Categories",
    "Subcategories",
    "AdonesCategories",
    "policy",
    "Adones",
    "RestaurantSettings",
    "Users",
    "UserWallet",
    "BusninessPlan",
    "basiccampaign",
    "Ratings",
    "cuisines",
    "Coupons",
    "Orders",
    "reports",
    "popup",
    "RestaurantBranches",
    "RestaurantZoneDeliveryFees",
    "BranchMenuItems",
    "zone",
    "Reasons",
    "Discounts",

] as const;

export const ACTION_NAMES = ["View", "Add", "Edit", "Delete", "Status"] as const;

export type ModuleName = (typeof MODULES)[number];
export type ActionName = (typeof ACTION_NAMES)[number];

export const BASE64_IMAGE_REGEX = /^data:image\/(jpeg|jpg|png|gif|webp);base64,/;
