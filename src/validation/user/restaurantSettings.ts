import { z } from "zod";

export const getRestaurantSettingsParamsSchema = z.object({
  restaurantId: z.string().uuid("Invalid Restaurant ID"),
});

