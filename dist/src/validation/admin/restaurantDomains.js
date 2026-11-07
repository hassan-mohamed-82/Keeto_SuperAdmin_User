"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDomainQuerySchema = exports.domainIdParamSchema = exports.restaurantIdParamSchema = exports.checkSubdomainQuerySchema = exports.addDomainSchema = void 0;
const zod_1 = require("zod");
/**
 * Strict hostname regex — no protocol, no path, no port, no spaces.
 * Must be lowercase-safe (we lower() before validating).
 */
const HOSTNAME_REGEX = /^(?:[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const MAIN_DOMAIN = (process.env.MAIN_DOMAIN ?? "orderfood.keeto.org").toLowerCase();
/** Validates a domain string: format, not our own domain, not *.keeto.org. */
const domainString = zod_1.z
    .string()
    .min(3)
    .max(255)
    .transform((v) => v.trim().toLowerCase())
    .refine((v) => HOSTNAME_REGEX.test(v), {
    message: "Invalid domain format. Provide a plain hostname without protocol, port, or path.",
})
    .refine((v) => v !== MAIN_DOMAIN, {
    message: "Cannot use the platform's own domain.",
})
    .refine((v) => !v.endsWith(".keeto.org") && v !== "keeto.org", {
    message: "Cannot use a keeto.org domain.",
});
/** POST /api/admin/restaurants/:id/domains */
exports.addDomainSchema = zod_1.z.union([
    zod_1.z.object({
        source: zod_1.z.literal("subdomain"),
        label: zod_1.z
            .string()
            .min(1, "Subdomain label is required")
            .transform((v) => v.trim().toLowerCase()),
        domain: zod_1.z.string().optional(),
    }),
    zod_1.z.object({
        domain: domainString,
        source: zod_1.z.enum(["external", "managed"]).default("external"),
        label: zod_1.z.string().optional(),
    }),
]);
/** GET /api/admin/domains/check-subdomain?label= */
exports.checkSubdomainQuerySchema = zod_1.z.object({
    label: zod_1.z
        .string()
        .min(1, "Subdomain label is required")
        .transform((v) => v.trim().toLowerCase()),
});
/** Params for /api/admin/restaurants/:id/domains */
exports.restaurantIdParamSchema = zod_1.z.object({
    id: zod_1.z.string().min(1, "Restaurant ID is required"),
});
/** Params for /api/admin/domains/:domainId/... */
exports.domainIdParamSchema = zod_1.z.object({
    domainId: zod_1.z.coerce.number().int().positive("Invalid domain ID"),
});
/** GET /api/resolve-domain?host= */
exports.resolveDomainQuerySchema = zod_1.z.object({
    host: zod_1.z
        .string()
        .min(1)
        .transform((v) => v.trim().toLowerCase().replace(/:\d+$/, "")), // strip port
});
