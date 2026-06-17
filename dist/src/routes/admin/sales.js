"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const sales_1 = require("../../controllers/admin/sales");
const router = express_1.default.Router();
// POST /api/admin/sales/login
router.post("/login", sales_1.loginSales);
// POST /api/admin/sales
router.post("/", sales_1.createSales);
// GET /api/admin/sales
router.get("/", sales_1.getAllSales);
// GET /api/admin/sales/:id
router.get("/:id", sales_1.getSalesById);
// PUT /api/admin/sales/:id
router.put("/:id", sales_1.updateSales);
// DELETE /api/admin/sales/:id
router.delete("/:id", sales_1.deleteSales);
exports.default = router;
