"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const deliveryMen_1 = require("../../controllers/shipping/deliveryMen");
const validation_1 = require("../../middlewares/validation");
const deliveryMan_1 = require("../../validation/shipping/deliveryMan");
const authenticated_1 = require("../../middlewares/authenticated");
const shippingAuth_1 = require("../../middlewares/shippingAuth");
const router = (0, express_1.Router)();
router.use(authenticated_1.authenticated);
// Read routes: viewer, dispatcher, admin
router.get("/available", (0, shippingAuth_1.requireShippingCompany)(), deliveryMen_1.getAvailableCouriers);
router.get("/", (0, shippingAuth_1.requireShippingCompany)(), deliveryMen_1.getDeliveryMen);
router.get("/:id", (0, shippingAuth_1.requireShippingCompany)(), deliveryMen_1.getDeliveryManById);
router.get("/:id/zones", (0, shippingAuth_1.requireShippingCompany)(), deliveryMen_1.getCourierZones);
router.get("/:id/shifts", (0, shippingAuth_1.requireShippingCompany)(), deliveryMen_1.getCourierShifts);
// Mutation routes: admin and dispatcher
router.post("/", (0, shippingAuth_1.requireShippingCompany)("admin", "dispatcher"), (0, validation_1.validate)(deliveryMan_1.createDeliveryManSchema), deliveryMen_1.createDeliveryMan);
router.post("/assign-existing", (0, shippingAuth_1.requireShippingCompany)("admin", "dispatcher"), (0, validation_1.validate)(deliveryMan_1.assignExistingDeliveryManSchema), deliveryMen_1.assignExistingDeliveryMan);
router.put("/:id", (0, shippingAuth_1.requireShippingCompany)("admin", "dispatcher"), (0, validation_1.validate)(deliveryMan_1.updateDeliveryManSchema), deliveryMen_1.updateDeliveryMan);
router.put("/:id/zones", (0, shippingAuth_1.requireShippingCompany)("admin", "dispatcher"), (0, validation_1.validate)(deliveryMan_1.setCourierZonesSchema), deliveryMen_1.updateCourierZones);
router.put("/:id/shifts", (0, shippingAuth_1.requireShippingCompany)("admin", "dispatcher"), (0, validation_1.validate)(deliveryMan_1.setCourierShiftsSchema), deliveryMen_1.updateCourierShifts);
// Destructive unassign: admin only
router.delete("/:id", (0, shippingAuth_1.requireShippingCompany)("admin"), deliveryMen_1.unassignOrDeleteDeliveryMan);
exports.default = router;
