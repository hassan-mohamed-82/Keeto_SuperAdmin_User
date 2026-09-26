import { z } from "zod";

export const getPaymentTransactionsQuerySchema = z.object({
    orderId: z.string().optional(),
    orderNumber: z.string().optional(),
    restaurantId: z.string().optional(),
    gateway: z.enum(["paymob", "kashier"]).optional(),
    status: z.enum(["pending", "success", "failed"]).optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
});

export type GetPaymentTransactionsQuery = z.infer<typeof getPaymentTransactionsQuerySchema>;
