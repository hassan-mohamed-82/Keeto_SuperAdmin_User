import z from "zod";

export const createBusTypeSchema = z.object({
  body: z.object({
    name: z.string().min(1, "Name is required").max(100, "Name is too long"),
    capacity: z.number().min(1, "Capacity must be at least 1"),
    description: z.string().max(255).optional(),
  }),
});


export const updateBusTypeSchema = z.object({
  params: z.object({
    Id: z.string().uuid("Invalid Bus Type ID"),
    }),
    body: z.object({
        name: z.string().min(1, "Name is required").max(100, "Name is too long").optional(),
        capacity: z.number().min(1, "Capacity must be at least 1").optional(),
        description: z.string().max(255).optional(),
        status: z.enum(["active", "inactive"]).optional(),
    }),
});