import { paymentMethods, restaurantSettings } from "../src/models/schema";
import { resolvePaymentTypeAndGateway } from "../src/services/restaurantWalletService";

(async () => {
  const executor = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            if (table === paymentMethods) {
              return [{ id: "m1", name: "wallet", nameAr: "محفظتى" }];
            }
            if (table === restaurantSettings) {
              return [{ paymentGatewayType: "CUSTOM" }];
            }
            return [];
          },
        }),
      }),
    }),
  } as any;

  const result = await resolvePaymentTypeAndGateway({
    restaurantId: "r1",
    paymentMethodId: "m1",
    executor,
  });

  if (result.paymentKind !== "user_wallet" || result.paymentGatewayType !== "SYSTEM") {
    throw new Error(`Unexpected wallet classification: ${JSON.stringify(result)}`);
  }

  console.log("wallet classification ok");
})();
