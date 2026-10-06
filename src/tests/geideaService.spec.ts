import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("axios", () => ({
    default: {
        post: vi.fn(),
    },
}));

import axios from "axios";
import { GeideaService } from "../services/payments/geidea/geidea.service";

describe("GeideaService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("creates a v1 hosted payment session compatible with Geidea's HPP checkout", async () => {
        vi.mocked(axios.post).mockResolvedValue({
            data: {
                session: { id: "session-123" },
                responseCode: "000",
            },
        });

        const session = await GeideaService.createPaymentSession({
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

        expect(axios.post).toHaveBeenCalledWith(
            "https://api.merchant.geidea.net/payment-intent/api/v1/direct/session",
            expect.objectContaining({
                amount: 100,
                currency: "EGP",
                merchantReferenceId: "order-123",
                customer: expect.objectContaining({
                    firstName: "Customer",
                    phoneNumber: "+201000000000",
                }),
            }),
            expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: `Basic ${Buffer.from("public-key:api-password").toString("base64")}`,
                }),
            })
        );

        expect(session.sessionId).toBe("session-123");
    });
});
