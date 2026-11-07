import { Request, Response } from "express";
import crypto from "crypto";
import { db } from "../../models/connection";
import { authHandoffCodes, restaurantDomains, users, restaurant_users } from "../../models/schema";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { BadRequest } from "../../Errors/BadRequest";
import { SuccessResponse } from "../../utils/response";
import { generateUserToken } from "../../utils/jwt";

/**
 * POST /api/auth/handoff
 * Generates a short-lived single-use handoff code bound to the user and return_host.
 */
export const handoff = async (req: Request, res: Response) => {
  // Must be an authenticated, non-guest user
  if (!req.user?.id || req.user.isGuest) {
    throw new BadRequest("Invalid request");
  }

  const { return_to } = req.body;

  if (!return_to || typeof return_to !== "string") {
    throw new BadRequest("Invalid request");
  }

  // Pre-checks: reject open redirect / injection vectors before URL parse
  const trimmed = return_to.trim();
  if (!trimmed.toLowerCase().startsWith("https://")) {
    throw new BadRequest("Invalid request");
  }
  if (trimmed.includes("@") || trimmed.includes("#")) {
    throw new BadRequest("Invalid request");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new BadRequest("Invalid request");
  }

  // Protocol must strictly be https:
  if (parsed.protocol !== "https:") {
    throw new BadRequest("Invalid request");
  }

  // No credentials
  if (parsed.username || parsed.password) {
    throw new BadRequest("Invalid request");
  }

  // No port in host
  if (parsed.port || parsed.host !== parsed.hostname) {
    throw new BadRequest("Invalid request");
  }

  // Path must be exactly /auth/complete
  if (parsed.pathname !== "/auth/complete") {
    throw new BadRequest("Invalid request");
  }

  // No query params allowed in return_to
  if (parsed.search) {
    throw new BadRequest("Invalid request");
  }

  const returnHost = parsed.hostname.toLowerCase();
  if (!returnHost) {
    throw new BadRequest("Invalid request");
  }

  // Validate that return_host exists in restaurant_domains with verified=1 (lowercase compare)
  const [matchedDomain] = await db
    .select({
      id: restaurantDomains.id,
      domain: restaurantDomains.domain,
    })
    .from(restaurantDomains)
    .where(
      and(
        eq(sql`LOWER(${restaurantDomains.domain})`, returnHost),
        eq(restaurantDomains.verified, 1)
      )
    )
    .limit(1);

  if (!matchedDomain) {
    throw new BadRequest("Invalid request");
  }

  // Generate random 32-byte code, store only its sha256 hash, TTL 60 seconds
  const code = crypto.randomBytes(32).toString("hex");
  const codeHash = crypto.createHash("sha256").update(code).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 1000);

  await db.insert(authHandoffCodes).values({
    codeHash,
    userId: req.user.id,
    returnHost,
    expiresAt,
  });

  // Never return access/refresh tokens in redirectUrl - only code
  return SuccessResponse(res, {
    redirectUrl: `${trimmed}?code=${code}`,
  });
};

/**
 * POST /api/auth/exchange-code
 * Atomically exchanges a valid single-use handoff code for user login credentials.
 */
export const exchangeCode = async (req: Request, res: Response) => {
  const originHeader = req.headers.origin;
  if (!originHeader || typeof originHeader !== "string") {
    throw new BadRequest("Invalid request");
  }

  let originHost: string;
  try {
    const parsedOrigin = new URL(originHeader);
    originHost = parsedOrigin.hostname.toLowerCase();
  } catch {
    throw new BadRequest("Invalid request");
  }

  if (!originHost) {
    throw new BadRequest("Invalid request");
  }

  const { code } = req.body;
  if (!code || typeof code !== "string" || code.length > 256) {
    throw new BadRequest("Invalid request");
  }

  const codeHash = crypto.createHash("sha256").update(code).digest("hex");

  // Atomic transaction: verify, lock row with for("update"), check origin, and mark used
  const now = new Date();
  const handoffRecord = await db.transaction(async (tx) => {
    const [record] = await tx
      .select()
      .from(authHandoffCodes)
      .where(
        and(
          eq(authHandoffCodes.codeHash, codeHash),
          isNull(authHandoffCodes.usedAt),
          gt(authHandoffCodes.expiresAt, now)
        )
      )
      .for("update");

    if (!record) {
      return null;
    }

    // Origin host must equal stored return_host
    if (record.returnHost.toLowerCase() !== originHost) {
      return null;
    }

    // Mark used in the same transaction
    await tx
      .update(authHandoffCodes)
      .set({ usedAt: now })
      .where(eq(authHandoffCodes.id, record.id));

    return record;
  });

  if (!handoffRecord) {
    throw new BadRequest("Invalid request");
  }

  // Fetch user
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, handoffRecord.userId))
    .limit(1);

  if (!user || user.status === "blocked" || user.deletedAt) {
    throw new BadRequest("Invalid request");
  }

  // Resolve restaurant for the custom domain and link user if needed
  const [domainRecord] = await db
    .select({ restaurantId: restaurantDomains.restaurantId })
    .from(restaurantDomains)
    .where(
      and(
        eq(sql`LOWER(${restaurantDomains.domain})`, handoffRecord.returnHost.toLowerCase()),
        eq(restaurantDomains.verified, 1)
      )
    )
    .limit(1);

  const restaurantId = domainRecord?.restaurantId || null;

  if (restaurantId) {
    const existingLink = await db
      .select()
      .from(restaurant_users)
      .where(
        and(
          eq(restaurant_users.restaurantId, restaurantId),
          eq(restaurant_users.userId, user.id)
        )
      )
      .limit(1);

    if (existingLink.length === 0) {
      await db.insert(restaurant_users).values({ restaurantId, userId: user.id });
    }
  }

  const token = generateUserToken({ id: user.id, name: user.name, restaurantId });
  const isProfileComplete =
    user.isProfileComplete || !(user.email && user.email.endsWith("@privaterelay.appleid.com"));

  if (!user.isProfileComplete && isProfileComplete) {
    await db.update(users).set({ isProfileComplete: true }).where(eq(users.id, user.id));
  }

  return SuccessResponse(res, {
    message: "Login successful",
    data: {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        isProfileComplete,
      },
    },
  });
};

