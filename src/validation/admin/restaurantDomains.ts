import { z } from "zod";

/**
 * Strict hostname regex — no protocol, no path, no port, no spaces.
 * Must be lowercase-safe (we lower() before validating).
 */
const HOSTNAME_REGEX =
  /^(?:[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

const MAIN_DOMAIN = (process.env.MAIN_DOMAIN ?? "orderfood.keeto.org").toLowerCase();

/** Validates a domain string: format, not our own domain, not *.keeto.org. */
const domainString = z
  .string()
  .min(3)
  .max(255)
  .transform((v) => v.trim().toLowerCase())
  .refine((v) => HOSTNAME_REGEX.test(v), {
    message:
      "Invalid domain format. Provide a plain hostname without protocol, port, or path.",
  })
  .refine((v) => v !== MAIN_DOMAIN, {
    message: "Cannot use the platform's own domain.",
  })
  .refine((v) => !v.endsWith(".keeto.org") && v !== "keeto.org", {
    message: "Cannot use a keeto.org domain.",
  });

/** POST /api/admin/restaurants/:id/domains */
export const addDomainSchema = z.object({
  domain: domainString,
  source: z.enum(["external", "managed"]).default("external"),
});

/** Params for /api/admin/restaurants/:id/domains */
export const restaurantIdParamSchema = z.object({
  id: z.string().min(1, "Restaurant ID is required"),
});

/** Params for /api/admin/domains/:domainId/... */
export const domainIdParamSchema = z.object({
  domainId: z.coerce.number().int().positive("Invalid domain ID"),
});

/** GET /api/resolve-domain?host= */
export const resolveDomainQuerySchema = z.object({
  host: z
    .string()
    .min(1)
    .transform((v) => v.trim().toLowerCase().replace(/:\d+$/, "")), // strip port
});
