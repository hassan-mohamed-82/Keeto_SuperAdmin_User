import { BadRequest } from "../../Errors/BadRequest";
import { claimWeightCheckout, releaseWeightCheckoutClaim } from "../../helpers/weightPayment.helper";
import { PAYMENT_ABANDON_MINUTES } from "../../helpers/weightCart.helper";
import { createOrderPaymentSession } from "../payments/paymentSession.service";
import { getActiveCustomGateway } from "../../utils/getActiveCustomGateway";
import { getSystemVisaSettings } from "../../utils/getSystemVisaSettings";
import { calculateVisaCommission } from "../../utils/calculateVisaCommission";

/**
 * Prepares online / Visa payment session and commission before the database transaction.
 */
export const preparePaymentSessionAndCommission = async (params: {
    isVisaPayment: boolean;
    isWalletPayment: boolean;
    hasWeightedItems: boolean;
    activeWeightRequest: any;
    assertWeightCartUnchanged: (tx: any, lockedRequestId: string) => Promise<void>;
    settings: any;
    orderId: string;
    orderNumber: string;
    restaurantId: string;
    totalAmount: number;
    restaurant: any;
    restaurantName?: string;
    userInfo: any;
}) => {
    const {
        isVisaPayment,
        isWalletPayment,
        hasWeightedItems,
        activeWeightRequest,
        assertWeightCartUnchanged,
        settings,
        orderId,
        orderNumber,
        restaurantId,
        totalAmount,
        restaurant,
        restaurantName,
        userInfo,
    } = params;

    const weightClaimRequestId: string | null =
        isVisaPayment && hasWeightedItems && activeWeightRequest ? activeWeightRequest.id : null;

    if (isVisaPayment) {
        if (!settings?.enableOnlinePayment) {
            throw new BadRequest("Online payment is not enabled for this restaurant.");
        }
        if (weightClaimRequestId) {
            await claimWeightCheckout(weightClaimRequestId, assertWeightCartUnchanged);
        }
    }

    let paymentSessionData: any = null;
    if (isVisaPayment) {
        paymentSessionData = await createOrderPaymentSession({
            orderId,
            orderNumber,
            restaurantId,
            totalAmount,
            restaurantSlug: restaurant?.slug || restaurantName || undefined,
            userInfo: {
                name: userInfo?.name,
                email: userInfo?.email,
                phone: userInfo?.phone,
            },
            ...(weightClaimRequestId
                ? { sessionExpiresAt: new Date(Date.now() + PAYMENT_ABANDON_MINUTES * 60 * 1000) }
                : {}),
        });
    }

    const finalPaymentGatewayType = isWalletPayment
        ? "SYSTEM"
        : paymentSessionData?.gatewayType ?? settings?.paymentGatewayType ?? "SYSTEM";

    let visaCommission = 0;
    if (isVisaPayment && finalPaymentGatewayType === "CUSTOM") {
        try {
            const activeCustom = await getActiveCustomGateway(restaurantId);
            if (activeCustom?.record) {
                visaCommission = calculateVisaCommission(
                    totalAmount,
                    activeCustom.record.percentageValue,
                    activeCustom.record.fixedValue,
                    activeCustom.record.tax
                );
            }
        } catch (e) {
            console.warn("[order] Failed to calculate custom gateway visaCommission:", e);
        }
    } else if (isVisaPayment && finalPaymentGatewayType === "SYSTEM") {
        const systemSettings = await getSystemVisaSettings();
        visaCommission = calculateVisaCommission(
            totalAmount,
            systemSettings.percentageValue,
            systemSettings.fixedValue,
            systemSettings.tax
        );
    }

    return {
        weightClaimRequestId,
        paymentSessionData,
        finalPaymentGatewayType,
        visaCommission,
    };
};

export { releaseWeightCheckoutClaim };
