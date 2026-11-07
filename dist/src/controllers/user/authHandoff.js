"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exchangeCode = exports.handoff = void 0;
const crypto_1 = __importDefault(require("crypto"));
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const BadRequest_1 = require("../../Errors/BadRequest");
const response_1 = require("../../utils/response");
const jwt_1 = require("../../utils/jwt");
/**
 * POST /api/auth/handoff
 * Generates a short-lived single-use handoff code bound to the user and return_host.
 */
const handoff = async (req, res) => {
    // Must be an authenticated, non-guest user
    if (!req.user?.id || req.user.isGuest) {
        throw new BadRequest_1.BadRequest("Invalid request");
    }
    const { return_to } = req.body;
    if (!return_to || typeof return_to !== "string") {
        throw new BadRequest_1.BadRequest("Invalid request");
    }
    // Pre-checks: reject open redirect / injection vectors before URL parse
    const trimmed = return_to.trim();
    if (!trimmed.toLowerCase().startsWith("https://")) {
        throw new BadRequest_1.BadRequest("Invalid request");
    }
    if (trimmed.includes("@") || trimmed.includes("#")) {
        throw new BadRequest_1.BadRequest("Invalid request");
    }
    let parsed;
    try {
        parsed = new URL(trimmed);
    }
    catch {
        throw new BadRequest_1.BadRequest("Invalid request");
    }
    // Protocol must strictly be https:
    if (parsed.protocol !== "https:") {
        throw new BadRequest_1.BadRequest("Invalid request");
    }
    // No credentials
    if (parsed.username || parsed.password) {
        throw new BadRequest_1.BadRequest("Invalid request");
    }
    // No port in host
    if (parsed.port || parsed.host !== parsed.hostname) {
        throw new BadRequest_1.BadRequest("Invalid request");
    }
    // Path must be exactly /auth/complete
    if (parsed.pathname !== "/auth/complete") {
        throw new BadRequest_1.BadRequest("Invalid request");
    }
    // No query params allowed in return_to
    if (parsed.search) {
        throw new BadRequest_1.BadRequest("Invalid request");
    }
    const returnHost = parsed.hostname.toLowerCase();
    if (!returnHost) {
        throw new BadRequest_1.BadRequest("Invalid request");
    }
    // Validate that return_host exists in restaurant_domains with verified=1 (lowercase compare)
    const [matchedDomain] = await connection_1.db
        .select({
        id: schema_1.restaurantDomains.id,
        domain: schema_1.restaurantDomains.domain,
    })
        .from(schema_1.restaurantDomains)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)((0, drizzle_orm_1.sql) `LOWER(${schema_1.restaurantDomains.domain})`, returnHost), (0, drizzle_orm_1.eq)(schema_1.restaurantDomains.verified, 1)))
        .limit(1);
    if (!matchedDomain) {
        throw new BadRequest_1.BadRequest("Invalid request");
    }
    // Generate random 32-byte code, store only its sha256 hash, TTL 60 seconds
    const code = crypto_1.default.randomBytes(32).toString("hex");
    const codeHash = crypto_1.default.createHash("sha256").update(code).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 1000);
    await connection_1.db.insert(schema_1.authHandoffCodes).values({
        codeHash,
        userId: req.user.id,
        returnHost,
        expiresAt,
    });
    // Never return access/refresh tokens in redirectUrl - only code
    return (0, response_1.SuccessResponse)(res, {
        redirectUrl: `${trimmed}?code=${code}`,
    });
};
exports.handoff = handoff;
/**
 * POST /api/auth/exchange-code
 * Atomically exchanges a valid single-use handoff code for user login credentials.
 */
const exchangeCode = async (req, res) => {
    const originHeader = req.headers.origin;
    if (!originHeader || typeof originHeader !== "string") {
        throw new BadRequest_1.BadRequest("Invalid request");
    }
    let originHost;
    try {
        const parsedOrigin = new URL(originHeader);
        originHost = parsedOrigin.hostname.toLowerCase();
    }
    catch {
        throw new BadRequest_1.BadRequest("Invalid request");
    }
    if (!originHost) {
        throw new BadRequest_1.BadRequest("Invalid request");
    }
    const { code } = req.body;
    if (!code || typeof code !== "string" || code.length > 256) {
        throw new BadRequest_1.BadRequest("Invalid request");
    }
    const codeHash = crypto_1.default.createHash("sha256").update(code).digest("hex");
    // Atomic transaction: verify, lock row with for("update"), check origin, and mark used
    const now = new Date();
    const handoffRecord = await connection_1.db.transaction(async (tx) => {
        const [record] = await tx
            .select()
            .from(schema_1.authHandoffCodes)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.authHandoffCodes.codeHash, codeHash), (0, drizzle_orm_1.isNull)(schema_1.authHandoffCodes.usedAt), (0, drizzle_orm_1.gt)(schema_1.authHandoffCodes.expiresAt, now)))
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
            .update(schema_1.authHandoffCodes)
            .set({ usedAt: now })
            .where((0, drizzle_orm_1.eq)(schema_1.authHandoffCodes.id, record.id));
        return record;
    });
    if (!handoffRecord) {
        throw new BadRequest_1.BadRequest("Invalid request");
    }
    // Fetch user
    const [user] = await connection_1.db
        .select()
        .from(schema_1.users)
        .where((0, drizzle_orm_1.eq)(schema_1.users.id, handoffRecord.userId))
        .limit(1);
    if (!user || user.status === "blocked" || user.deletedAt) {
        throw new BadRequest_1.BadRequest("Invalid request");
    }
    // Resolve restaurant for the custom domain and link user if needed
    const [domainRecord] = await connection_1.db
        .select({ restaurantId: schema_1.restaurantDomains.restaurantId })
        .from(schema_1.restaurantDomains)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)((0, drizzle_orm_1.sql) `LOWER(${schema_1.restaurantDomains.domain})`, handoffRecord.returnHost.toLowerCase()), (0, drizzle_orm_1.eq)(schema_1.restaurantDomains.verified, 1)))
        .limit(1);
    const restaurantId = domainRecord?.restaurantId || null;
    if (restaurantId) {
        const existingLink = await connection_1.db
            .select()
            .from(schema_1.restaurant_users)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurant_users.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurant_users.userId, user.id)))
            .limit(1);
        if (existingLink.length === 0) {
            await connection_1.db.insert(schema_1.restaurant_users).values({ restaurantId, userId: user.id });
        }
    }
    const token = (0, jwt_1.generateUserToken)({ id: user.id, name: user.name, restaurantId });
    const isProfileComplete = user.isProfileComplete || !(user.email && user.email.endsWith("@privaterelay.appleid.com"));
    if (!user.isProfileComplete && isProfileComplete) {
        await connection_1.db.update(schema_1.users).set({ isProfileComplete: true }).where((0, drizzle_orm_1.eq)(schema_1.users.id, user.id));
    }
    return (0, response_1.SuccessResponse)(res, {
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
exports.exchangeCode = exchangeCode;
