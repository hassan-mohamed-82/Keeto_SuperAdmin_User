import express from "express";
import { createSales, getAllSales, getSalesById, updateSales, deleteSales, loginSales } from "../../controllers/admin/sales";

const router = express.Router();

// POST /api/admin/sales/login
router.post("/login", loginSales);

// POST /api/admin/sales
router.post("/", createSales);

// GET /api/admin/sales
router.get("/", getAllSales);

// GET /api/admin/sales/:id
router.get("/:id", getSalesById);

// PUT /api/admin/sales/:id
router.put("/:id", updateSales);

// DELETE /api/admin/sales/:id
router.delete("/:id", deleteSales);

export default router;