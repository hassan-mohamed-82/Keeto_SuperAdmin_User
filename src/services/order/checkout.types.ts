export const roundMoney = (amount: number): number => Math.round(amount * 100) / 100;

export const parseJsonArray = (val: any): any[] => {
    if (!val) return [];
    if (typeof val === "string") {
        try {
            const parsed = JSON.parse(val);
            return typeof parsed === "string" ? JSON.parse(parsed) : (Array.isArray(parsed) ? parsed : []);
        } catch {
            return [];
        }
    }
    return Array.isArray(val) ? val : [];
};

export interface GuestAddressRow {
    id: string;
    userId: string;
    title: string;
    street: string;
    number: string;
    floor: string | null;
    apartment: string | null;
    landmark: string | null;
    location: string | null;
    fulladdress: string;
    lat: string;
    lng: string;
}

export interface PaymentMethodResolution {
    selectedPayment: any;
    paymentMethodName: string;
    paymentMethodNameAr: string;
    isWalletPayment: boolean;
    isCashPayment: boolean;
    isVisaPayment: boolean;
}

export interface RestaurantAndPlanInfo {
    restaurant: any;
    plan: any;
    schedulesList: any[];
    settings: any;
    storedOrderSource: string;
}

export interface OperatingHoursInfo {
    status: any;
    defaultPreparingDuration: number;
    resolvedOrderType: "delivery" | "takeaway" | "dine_in";
}

export interface DeliveryResolutionResult {
    deliveryFee: number;
    calculatedDeliveryFee: number;
    resolvedZoneId: string | null;
    resolvedBranchId: string | null;
    deliveryGenericZoneId: string | null;
    shippingAddressSnapshot: any;
    targetShippingCompanyId: string | null;
    isCompanyActive: boolean;
    branchSnapshotData: any;
    isFreeDelivery: boolean;
}

export interface DiscountResolutionResult {
    totalDiscount: number;
    appliedCoupon: any;
    isFreeDelivery: boolean;
    orderDiscountId: string | null;
    orderCouponId: string | null;
    orderFirstOrderDiscountId: string | null;
    orderDiscountType: "percentage" | "fixed_amount" | null;
    orderDiscountValue: string | null;
    orderDiscountSource: "food_level" | "restaurant_discount" | "global_discount" | "coupon" | "first_order_discount" | null;
    firstOrderDiscountAmount: number;
    appliedDiscountIds: Set<string>;
}
