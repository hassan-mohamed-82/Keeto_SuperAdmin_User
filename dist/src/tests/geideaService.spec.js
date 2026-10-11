"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const crypto_1 = __importDefault(require("crypto"));
vitest_1.vi.mock("axios", () => ({
    default: {
        post: vitest_1.vi.fn(),
    },
}));
const axios_1 = __importDefault(require("axios"));
const geidea_service_1 = require("../services/payments/geidea/geidea.service");
(0, vitest_1.describe)("GeideaService", () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
    });
    (0, vitest_1.it)("creates a signed v2 hosted payment session", async () => {
        vitest_1.vi.mocked(axios_1.default.post).mockResolvedValue({
            data: {
                session: { id: "session-123" },
                responseCode: "000",
            },
        });
        const session = await geidea_service_1.GeideaService.createPaymentSession({
            credentials: {
                publicKey: "public-key",
                apiPassword: "api-password",
                environment: "LIVE",
            },
            orderId: "order-123",
            orderNumber: "K-123",
            amount: 100,
            customer: {},
        });
        (0, vitest_1.expect)(axios_1.default.post).toHaveBeenCalledWith("https://api.merchant.geidea.net/payment-intent/api/v2/direct/session", vitest_1.expect.objectContaining({
            amount: 100,
            currency: "EGP",
            merchantReferenceId: "order-123",
            timestamp: vitest_1.expect.any(String),
            signature: vitest_1.expect.any(String),
            customer: vitest_1.expect.objectContaining({
                firstName: "Customer",
                phoneNumber: "+201000000000",
            }),
        }), vitest_1.expect.objectContaining({
            headers: vitest_1.expect.objectContaining({
                Authorization: `Basic ${Buffer.from("public-key:api-password").toString("base64")}`,
            }),
        }));
        const requestPayload = vitest_1.vi.mocked(axios_1.default.post).mock.calls[0][1];
        const expectedSignature = crypto_1.default
            .createHmac("sha256", "api-password")
            .update(`public-key100.00EGPorder-123${requestPayload.timestamp}`)
            .digest("base64");
        (0, vitest_1.expect)(requestPayload.signature).toBe(expectedSignature);
        (0, vitest_1.expect)(session.sessionId).toBe("session-123");
    });
});
