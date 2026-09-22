import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { validate } from "../../middlewares/validation";
import {
    createCredentials,
    getCredentialsByRestaurant,
    updateCredential,
    deleteCredential,
    toggleCredential,
} from "../../controllers/admin/restaurantPaymentCredentials";
import {
    createPaymentCredentialsSchema,
    updatePaymentCredentialsSchema,
    toggleCredentialSchema,
} from "../../validation/admin/restaurantPaymentCredentials";
import { hasPermission } from "../../middlewares";

const router = Router();

router.post(
    "/:restaurantId",
    hasPermission("restaurantPaymentCredentials", "Add"),
    validate(createPaymentCredentialsSchema),
    catchAsync(createCredentials)
);

router.get(
    "/:restaurantId",
    hasPermission("restaurantPaymentCredentials", "View"),
    catchAsync(getCredentialsByRestaurant)
);

router.put(
    "/:restaurantId/:credentialId",
    hasPermission("restaurantPaymentCredentials", "Edit"),
    validate(updatePaymentCredentialsSchema),
    catchAsync(updateCredential)
);

router.delete(
    "/:restaurantId/:credentialId",
    hasPermission("restaurantPaymentCredentials", "Delete"),
    catchAsync(deleteCredential)
);

router.put(
    "/:restaurantId/:credentialId/toggle",
    hasPermission("restaurantPaymentCredentials", "Status"),
    validate(toggleCredentialSchema),
    catchAsync(toggleCredential)
);

export default router;
