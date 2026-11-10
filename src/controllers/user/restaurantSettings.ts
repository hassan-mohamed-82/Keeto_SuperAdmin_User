import { Request, Response } from 'express';
import { db } from '../../models/connection';
import { restaurantSettings, defaultOrderNowSetting } from '../../models/schema';
import { eq } from 'drizzle-orm';
import { SuccessResponse } from '../../utils/response';
import { NotFound } from '../../Errors/NotFound';

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

    const responseData = {
        ...settings,
        orderNowSetting: settings.orderNowSetting
            ? { ...defaultOrderNowSetting, ...settings.orderNowSetting }
            : defaultOrderNowSetting,
    };

    SuccessResponse(res, { message: "Restaurant settings fetched successfully", data: responseData });
};
