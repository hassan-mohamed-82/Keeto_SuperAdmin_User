import express from "express";
import { createSales, getAllSales, getSalesById, updateSales, deleteSales, loginSales } from "../../controllers/admin/sales";
import { hasPermission } from "../../middlewares/hasPermission";

const router = express.Router();

// POST /api/admin/sales/login
router.post("/login", loginSales);

// POST /api/admin/sales
router.post("/", hasPermission("Sales", "Add"), createSales);

// GET /api/admin/sales
router.get("/", hasPermission("Sales", "View"), getAllSales);

// GET /api/admin/sales/:id
router.get("/:id", hasPermission("Sales", "View"), getSalesById);

// PUT /api/admin/sales/:id
router.put("/:id", hasPermission("Sales", "Edit"), updateSales);

// DELETE /api/admin/sales/:id
router.delete("/:id", hasPermission("Sales", "Delete"), deleteSales);

export default router;