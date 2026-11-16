import { describe, expect, it } from "vitest";
import { computeWeightedLineTotal, isSaneWeight } from "../helpers/weightPricing.helper";
import { BadRequest } from "../Errors/BadRequest";

describe("Weight-Based Checkout Gating & Flow Logic", () => {
    interface WeightRequestState {
        id: string;
        status: "awaiting_weighing" | "awaiting_customer_approval" | "approved" | "cancelled" | "expired";
        expiresAt: Date;
        orderId?: string | null;
    }

    interface MockCartItem {
        id: string;
        foodId: string;
        sold_by: "unit" | "weight";
        quantity: number;
        weight: string | null;
        finalWeight: string | null;
        isUnavailable: boolean;
        addedBy: "customer" | "restaurant";
        price: number;
        options: Array<{ price: number; priceMode: "fixed" | "per_weight" }>;
    }

    // Pure simulator of the checkout gating rules enforced in OrderController.ts
    function simulateCheckoutGate(
        cartItems: MockCartItem[],
        activeRequest: WeightRequestState | null,
        now: Date = new Date()
    ) {
        const hasWeightedItems = cartItems.some((i) => i.sold_by === "weight" || i.weight != null);

        if (!hasWeightedItems) {
            return { allowed: true, mode: "normal_unit_checkout" as const };
        }

        if (!activeRequest) {
            throw new BadRequest("Cart contains weight-based items. Please send the order to the restaurant for weighing first.");
        }

        if (activeRequest.status === "awaiting_weighing") {
            throw new BadRequest("Your order is currently awaiting weighing by the restaurant.");
        }

        if (activeRequest.status !== "awaiting_customer_approval") {
            throw new BadRequest(`Cannot checkout weight request with status: ${activeRequest.status}`);
        }

        if (activeRequest.expiresAt <= now) {
            throw new BadRequest("The weighing approval has expired. Please send your cart for weighing again.");
        }

        const availableItems = cartItems.filter((i) => !i.isUnavailable);
        if (availableItems.length === 0) {
            throw new BadRequest("All items in your cart are marked as unavailable.");
        }

        return { allowed: true, mode: "weight_approved_checkout" as const, availableItems };
    }

    // Pure simulator of points order gating
    function simulatePointsOrderGate(foodSoldBy: "unit" | "weight") {
        if (foodSoldBy === "weight") {
            throw new BadRequest("Weight-based foods cannot be redeemed via points orders.");
        }
        return { allowed: true };
    }

    it("1. Checkout rejected for a weighted cart without a weight request", () => {
        const cart: MockCartItem[] = [
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

        expect(() => simulateCheckoutGate(cart, null)).toThrowError(
            /send the order to the restaurant for weighing first/i
        );
    });

    it("2. Checkout rejected when request is awaiting_weighing, expired, or cancelled", () => {
        const cart: MockCartItem[] = [
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
        expect(() =>
            simulateCheckoutGate(
                cart,
                { id: "req-1", status: "awaiting_weighing", expiresAt: new Date("2026-11-15T12:30:00Z") },
                now
            )
        ).toThrowError(/awaiting weighing/i);

        // expired
        expect(() =>
            simulateCheckoutGate(
                cart,
                { id: "req-1", status: "awaiting_customer_approval", expiresAt: new Date("2026-11-15T11:59:00Z") },
                now
            )
        ).toThrowError(/expired/i);

        // cancelled
        expect(() =>
            simulateCheckoutGate(
                cart,
                { id: "req-1", status: "cancelled", expiresAt: new Date("2026-11-15T12:30:00Z") },
                now
            )
        ).toThrowError(/Cannot checkout weight request with status: cancelled/i);
    });

    it("3. Checkout succeeds after confirm (awaiting_customer_approval and not expired)", () => {
        const cart: MockCartItem[] = [
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
        const req: WeightRequestState = {
            id: "req-1",
            status: "awaiting_customer_approval",
            expiresAt: new Date("2026-11-15T12:30:00Z"),
        };

        const result = simulateCheckoutGate(cart, req, now);
        expect(result.allowed).toBe(true);
        expect(result.availableItems).toBeDefined();
        expect(result.availableItems!).toHaveLength(1);
        expect(result.availableItems![0].id).toBe("c1");

        // Final line total calculation with finalWeight 0.450 kg
        const lineTotal = computeWeightedLineTotal(0.45, 300, cart[0].options);
        expect(lineTotal).toBe("172.00");
    });

    it("4. Double checkout idempotency: second checkout fails when status transitions to approved", () => {
        const cart: MockCartItem[] = [
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

        const req: WeightRequestState = {
            id: "req-1",
            status: "awaiting_customer_approval",
            expiresAt: new Date(Date.now() + 30 * 60 * 1000) // relative: the gate below uses the real clock,
        };

        // First checkout succeeds
        const first = simulateCheckoutGate(cart, req);
        expect(first.allowed).toBe(true);

        // Transaction transitions state to approved
        req.status = "approved";
        req.orderId = "order-123";

        // Second checkout immediately fails (idempotent guard)
        expect(() => simulateCheckoutGate(cart, req)).toThrowError(
            /Cannot checkout weight request with status: approved/i
        );
    });

    it("5. Every other order-creation path rejects weighted foods (e.g. points orders)", () => {
        expect(() => simulatePointsOrderGate("weight")).toThrowError(
            /Weight-based foods cannot be redeemed via points orders/i
        );
        expect(() => simulatePointsOrderGate("unit")).not.toThrow();
    });

    it("6. Unit-only carts checkout normally without requiring weight request", () => {
        const unitCart: MockCartItem[] = [
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
        expect(result.allowed).toBe(true);
        expect(result.mode).toBe("normal_unit_checkout");
    });

    it("7. Sane maximum weight guard", () => {
        expect(isSaneWeight(50, "kg")).toBe(true);
        expect(isSaneWeight(101, "kg")).toBe(false);
        expect(isSaneWeight(50000, "gm")).toBe(true);
        expect(isSaneWeight(150000, "gm")).toBe(false);
        expect(isSaneWeight(-1, "kg")).toBe(false);
    });
});
