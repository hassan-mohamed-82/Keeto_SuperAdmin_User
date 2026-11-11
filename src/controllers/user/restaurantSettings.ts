import { Request, Response } from 'express';
import { db } from '../../models/connection';
import { restaurantSettings, defaultOrderNowSetting, OrderNowSetting } from '../../models/schema';
import { eq } from 'drizzle-orm';
import { SuccessResponse } from '../../utils/response';
import { NotFound } from '../../Errors/NotFound';

/**
 * Safely parses a value that may already be an object or a raw JSON string.
 * MySQL json columns can sometimes be returned as strings by the driver.
 */
function parseJsonField<T>(value: T | string | null | undefined, fallback: T): T {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value) as T;
        } catch {
            return fallback;
        }
    }
    return value as T;
}

export const getRestaurantSettings = async (req: Request, res: Response): Promise<void> => {
    const { restaurantId } = req.params;

    const [settings] = await db.select({
        firstColor: restaurantSettings.firstColor,
        secondColor: restaurantSettings.secondColor,
        firstTextColor: restaurantSettings.firstTextColor,
        secondTextColor: restaurantSettings.secondTextColor,
        productView: restaurantSettings.productView,
        isTemporarilyClosed: restaurantSettings.isTemporarilyClosed,
        instantOrder: restaurantSettings.instantOrder,
        orderNowSetting: restaurantSettings.orderNowSetting,
    })
        .from(restaurantSettings)
        .where(eq(restaurantSettings.restaurantId, restaurantId))
        .limit(1);

    if (!settings) {
        throw new NotFound("Restaurant settings not found");
    }

    // Parse orderNowSetting — MySQL may return JSON columns as raw strings
    const parsedOrderNowSetting = parseJsonField<OrderNowSetting>(
        settings.orderNowSetting as unknown as string | OrderNowSetting,
        defaultOrderNowSetting
    );

    const responseData = {
        restaurantId,
        firstColor: settings.firstColor,
        secondColor: settings.secondColor,
        firstTextColor: settings.firstTextColor,
        secondTextColor: settings.secondTextColor,
        productView: settings.productView,
        isTemporarilyClosed: settings.isTemporarilyClosed,
        instantOrder: settings.instantOrder,
        orderNowSetting: { ...defaultOrderNowSetting, ...parsedOrderNowSetting },
    };

    SuccessResponse(res, { message: "Restaurant settings fetched successfully", data: responseData });
};
