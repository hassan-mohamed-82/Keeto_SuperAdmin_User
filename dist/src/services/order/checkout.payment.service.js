"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.releaseWeightCheckoutClaim = exports.preparePaymentSessionAndCommission = void 0;
const BadRequest_1 = require("../../Errors/BadRequest");
const weightPayment_helper_1 = require("../../helpers/weightPayment.helper");
Object.defineProperty(exports, "releaseWeightCheckoutClaim", { enumerable: true, get: function () { return weightPayment_helper_1.releaseWeightCheckoutClaim; } });
const weightCart_helper_1 = require("../../helpers/weightCart.helper");
const paymentSession_service_1 = require("../payments/paymentSession.service");
const getActiveCustomGateway_1 = require("../../utils/getActiveCustomGateway");
const getSystemVisaSettings_1 = require("../../utils/getSystemVisaSettings");
const calculateVisaCommission_1 = require("../../utils/calculateVisaCommission");
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
/**
 * Prepares online / Visa payment session and commission before the database transaction.
 */
const preparePaymentSessionAndCommission = async (params) => {
    const { isVisaPayment, isWalletPayment, hasWeightedItems, activeWeightRequest, assertWeightCartUnchanged, settings, orderId, orderNumber, restaurantId, branchId, totalAmount, restaurant, restaurantName, userInfo, } = params;
    const weightClaimRequestId = isVisaPayment && hasWeightedItems && activeWeightRequest ? activeWeightRequest.id : null;
    if (isVisaPayment) {
        if (!settings?.enableOnlinePayment) {
            throw new BadRequest_1.BadRequest("Online payment is not enabled for this restaurant.");
        }
        if (branchId) {
            const [branchRow] = await connection_1.db
                .select({
                id: schema_1.branches.id,
                name: schema_1.branches.name,
                nameAr: schema_1.branches.nameAr,
                visa_status: schema_1.branches.visa_status,
            })
                .from(schema_1.branches)
                .where((0, drizzle_orm_1.eq)(schema_1.branches.id, branchId))
                .limit(1);
            if (branchRow && branchRow.visa_status === false) {
                const branchDisplayName = branchRow.nameAr || branchRow.name || "the selected branch";
                throw new BadRequest_1.BadRequest(`Online payment (Visa) is not available for ${branchDisplayName}.`);
            }
        }
        if (weightClaimRequestId) {
            await (0, weightPayment_helper_1.claimWeightCheckout)(weightClaimRequestId, assertWeightCartUnchanged);
        }
    }
    let paymentSessionData = null;
    if (isVisaPayment) {
        paymentSessionData = await (0, paymentSession_service_1.createOrderPaymentSession)({
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
                ? { sessionExpiresAt: new Date(Date.now() + weightCart_helper_1.PAYMENT_ABANDON_MINUTES * 60 * 1000) }
                : {}),
        });
    }
    const finalPaymentGatewayType = isWalletPayment
        ? "SYSTEM"
        : paymentSessionData?.gatewayType ?? settings?.paymentGatewayType ?? "SYSTEM";
    let visaCommission = 0;
    if (isVisaPayment && finalPaymentGatewayType === "CUSTOM") {
        try {
            const activeCustom = await (0, getActiveCustomGateway_1.getActiveCustomGateway)(restaurantId);
            if (activeCustom?.record) {
                visaCommission = (0, calculateVisaCommission_1.calculateVisaCommission)(totalAmount, activeCustom.record.percentageValue, activeCustom.record.fixedValue, activeCustom.record.tax);
            }
        }
        catch (e) {
            console.warn("[order] Failed to calculate custom gateway visaCommission:", e);
        }
    }
    else if (isVisaPayment && finalPaymentGatewayType === "SYSTEM") {
        const systemSettings = await (0, getSystemVisaSettings_1.getSystemVisaSettings)();
        visaCommission = (0, calculateVisaCommission_1.calculateVisaCommission)(totalAmount, systemSettings.percentageValue, systemSettings.fixedValue, systemSettings.tax);
    }
    return {
        weightClaimRequestId,
        paymentSessionData,
        finalPaymentGatewayType,
        visaCommission,
    };
};
exports.preparePaymentSessionAndCommission = preparePaymentSessionAndCommission;
