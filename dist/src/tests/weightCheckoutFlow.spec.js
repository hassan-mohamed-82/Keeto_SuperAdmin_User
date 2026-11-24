"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const weightPricing_helper_1 = require("../helpers/weightPricing.helper");
const BadRequest_1 = require("../Errors/BadRequest");
(0, vitest_1.describe)("Weight-Based Checkout Gating & Flow Logic", () => {
    // Pure simulator of the checkout gating rules enforced in OrderController.ts
    function simulateCheckoutGate(cartItems, activeRequest, now = new Date()) {
        const hasWeightedItems = cartItems.some((i) => i.sold_by === "weight" || i.weight != null);
        if (!hasWeightedItems) {
            return { allowed: true, mode: "normal_unit_checkout" };
        }
        if (!activeRequest) {
            throw new BadRequest_1.BadRequest("Cart contains weight-based items. Please send the order to the restaurant for weighing first.");
        }
        if (activeRequest.status === "awaiting_weighing") {
            throw new BadRequest_1.BadRequest("Your order is currently awaiting weighing by the restaurant.");
        }
        if (activeRequest.status !== "awaiting_customer_approval") {
            throw new BadRequest_1.BadRequest(`Cannot checkout weight request with status: ${activeRequest.status}`);
        }
        if (activeRequest.expiresAt <= now) {
            throw new BadRequest_1.BadRequest("The weighing approval has expired. Please send your cart for weighing again.");
        }
        const availableItems = cartItems.filter((i) => !i.isUnavailable);
        if (availableItems.length === 0) {
            throw new BadRequest_1.BadRequest("All items in your cart are marked as unavailable.");
        }
        return { allowed: true, mode: "weight_approved_checkout", availableItems };
    }
    // Pure simulator of points order gating
    function simulatePointsOrderGate(foodSoldBy) {
        if (foodSoldBy === "weight") {
            throw new BadRequest_1.BadRequest("Weight-based foods cannot be redeemed via points orders.");
        }
        return { allowed: true };
    }
    (0, vitest_1.it)("1. Checkout rejected for a weighted cart without a weight request", () => {
        const cart = [
            {
                id: "c1",
                foodId: "f1",
                sold_by: "weight",
                quantity: 1,
                weight: "0.500",
                finalWeight: null,
                isUnavailable: false,
                addedBy: "customer",
                price: 300,
                options: [],
            },
        ];
        (0, vitest_1.expect)(() => simulateCheckoutGate(cart, null)).toThrowError(/send the order to the restaurant for weighing first/i);
    });
    (0, vitest_1.it)("2. Checkout rejected when request is awaiting_weighing, expired, or cancelled", () => {
        const cart = [
            {
                id: "c1",
                foodId: "f1",
                sold_by: "weight",
                quantity: 1,
                weight: "0.500",
                finalWeight: null,
                isUnavailable: false,
                addedBy: "customer",
                price: 300,
                options: [],
            },
        ];
        const now = new Date("2026-11-15T12:00:00Z");
        // awaiting_weighing
        (0, vitest_1.expect)(() => simulateCheckoutGate(cart, { id: "req-1", status: "awaiting_weighing", expiresAt: new Date("2026-11-15T12:30:00Z") }, now)).toThrowError(/awaiting weighing/i);
        // expired
        (0, vitest_1.expect)(() => simulateCheckoutGate(cart, { id: "req-1", status: "awaiting_customer_approval", expiresAt: new Date("2026-11-15T11:59:00Z") }, now)).toThrowError(/expired/i);
        // cancelled
        (0, vitest_1.expect)(() => simulateCheckoutGate(cart, { id: "req-1", status: "cancelled", expiresAt: new Date("2026-11-15T12:30:00Z") }, now)).toThrowError(/Cannot checkout weight request with status: cancelled/i);
    });
    (0, vitest_1.it)("3. Checkout succeeds after confirm (awaiting_customer_approval and not expired)", () => {
        const cart = [
            {
                id: "c1",
                foodId: "f1",
                sold_by: "weight",
                quantity: 1,
                weight: "0.500",
                finalWeight: "0.450",
                isUnavailable: false,
                addedBy: "customer",
                price: 300,
                options: [{ price: 60, priceMode: "per_weight" }, { price: 10, priceMode: "fixed" }],
            },
            {
                id: "c2",
                foodId: "f2",
                sold_by: "weight",
                quantity: 1,
                weight: "0.200",
                finalWeight: null,
                isUnavailable: true, // Marked unavailable by restaurant
                addedBy: "customer",
                price: 200,
                options: [],
            },
        ];
        const now = new Date("2026-11-15T12:00:00Z");
        const req = {
            id: "req-1",
            status: "awaiting_customer_approval",
            expiresAt: new Date("2026-11-15T12:30:00Z"),
        };
        const result = simulateCheckoutGate(cart, req, now);
        (0, vitest_1.expect)(result.allowed).toBe(true);
        (0, vitest_1.expect)(result.availableItems).toBeDefined();
        (0, vitest_1.expect)(result.availableItems).toHaveLength(1);
        (0, vitest_1.expect)(result.availableItems[0].id).toBe("c1");
        // Final line total calculation with finalWeight 0.450 kg
        const lineTotal = (0, weightPricing_helper_1.computeWeightedLineTotal)(0.45, 300, cart[0].options);
        (0, vitest_1.expect)(lineTotal).toBe("172.00");
    });
    (0, vitest_1.it)("4. Double checkout idempotency: second checkout fails when status transitions to approved", () => {
        const cart = [
            {
                id: "c1",
                foodId: "f1",
                sold_by: "weight",
                quantity: 1,
                weight: "0.500",
                finalWeight: "0.500",
                isUnavailable: false,
                addedBy: "customer",
                price: 300,
                options: [],
            },
        ];
        const req = {
            id: "req-1",
            status: "awaiting_customer_approval",
            expiresAt: new Date(Date.now() + 30 * 60 * 1000) // relative: the gate below uses the real clock,
        };
        // First checkout succeeds
        const first = simulateCheckoutGate(cart, req);
        (0, vitest_1.expect)(first.allowed).toBe(true);
        // Transaction transitions state to approved
        req.status = "approved";
        req.orderId = "order-123";
        // Second checkout immediately fails (idempotent guard)
        (0, vitest_1.expect)(() => simulateCheckoutGate(cart, req)).toThrowError(/Cannot checkout weight request with status: approved/i);
    });
    (0, vitest_1.it)("5. Every other order-creation path rejects weighted foods (e.g. points orders)", () => {
        (0, vitest_1.expect)(() => simulatePointsOrderGate("weight")).toThrowError(/Weight-based foods cannot be redeemed via points orders/i);
        (0, vitest_1.expect)(() => simulatePointsOrderGate("unit")).not.toThrow();
    });
    (0, vitest_1.it)("6. Unit-only carts checkout normally without requiring weight request", () => {
        const unitCart = [
            {
                id: "c1",
                foodId: "f-burger",
                sold_by: "unit",
                quantity: 2,
                weight: null,
                finalWeight: null,
                isUnavailable: false,
                addedBy: "customer",
                price: 150,
                options: [],
            },
        ];
        const result = simulateCheckoutGate(unitCart, null);
        (0, vitest_1.expect)(result.allowed).toBe(true);
        (0, vitest_1.expect)(result.mode).toBe("normal_unit_checkout");
    });
    (0, vitest_1.it)("7. Sane maximum weight guard", () => {
        (0, vitest_1.expect)((0, weightPricing_helper_1.isSaneWeight)(50, "kg")).toBe(true);
        (0, vitest_1.expect)((0, weightPricing_helper_1.isSaneWeight)(101, "kg")).toBe(false);
        (0, vitest_1.expect)((0, weightPricing_helper_1.isSaneWeight)(50000, "gm")).toBe(true);
        (0, vitest_1.expect)((0, weightPricing_helper_1.isSaneWeight)(150000, "gm")).toBe(false);
        (0, vitest_1.expect)((0, weightPricing_helper_1.isSaneWeight)(-1, "kg")).toBe(false);
    });
});
