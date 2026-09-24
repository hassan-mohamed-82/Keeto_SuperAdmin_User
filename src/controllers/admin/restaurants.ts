import { Request, Response } from "express";
import { db } from "../../models/connection";
import {
    restaurants,
    cuisines,
    zones,
    restaurantWallets,
    food,
    restrauntadmin,
    restaurantBusinessPlans,
    sales,
    restaurantSettings,
    cities,
    restaurantPaymentCredentials,
} from "../../models/schema";
import { eq, sql, inArray, and } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import { saveBase64Image, handleImageUpdate } from "../../utils/handleImages";
import { encryptSecret } from "../../utils/encryption";

// Helper: Parse payment credentials from request body (accepts array, single object, or JSON string)
const parsePaymentCredentialsInput = (input: any): any[] => {
    if (!input) return [];
    let parsed = input;
    if (typeof input === "string") {
        try {
            parsed = JSON.parse(input);
        } catch {
            return [];
        }
    }
    if (Array.isArray(parsed)) {
        return parsed;
    } else if (typeof parsed === "object" && parsed !== null) {
        return [parsed];
    }
    return [];
};

// Helper: Safely extract credentials object from input (tolerates JSON strings and character-spread objects)
const extractRawCredentials = (item: any): Record<string, any> => {
    let creds = item?.credentials ?? item;
    if (typeof creds === "string") {
        try {
            creds = JSON.parse(creds);
        } catch {
            creds = null;
        }
    }
    // Auto-heal if previously corrupted with character-spread keys: { 0: '{', 1: '"', ... }
    if (creds && typeof creds === "object" && "0" in creds && !("mid" in creds) && !("apiKey" in creds)) {
        try {
            const reconstructed = Object.keys(creds)
                .sort((a, b) => Number(a) - Number(b))
                .map((k) => creds[k])
                .join("");
            creds = JSON.parse(reconstructed);
        } catch {}
    }
    if (creds && typeof creds === "object") {
        return { ...creds };
    }
    return {
        apiKey: item?.apiKey,
        hmac: item?.hmac,
        integrationId: item?.integrationId,
        iframeId: item?.iframeId,
        callbackUrl: item?.callbackUrl,
        mid: item?.mid,
        secretKey: item?.secretKey,
        baseUrl: item?.baseUrl,
    };
};

// Helper: Encrypt sensitive fields in payment credentials
const encryptCredFields = (creds: any): Record<string, any> => {
    let parsed = creds;
    if (typeof creds === "string") {
        try {
            parsed = JSON.parse(creds);
        } catch {
            parsed = {};
        }
    }
    if (parsed && typeof parsed === "object" && "0" in parsed && !("mid" in parsed) && !("apiKey" in parsed)) {
        try {
            const reconstructed = Object.keys(parsed)
                .sort((a, b) => Number(a) - Number(b))
                .map((k) => parsed[k])
                .join("");
            parsed = JSON.parse(reconstructed);
        } catch {}
    }
    const enc = parsed && typeof parsed === "object" ? { ...parsed } : {};
    if (enc.apiKey && typeof enc.apiKey === "string" && !enc.apiKey.startsWith("******")) {
        enc.apiKey = encryptSecret(enc.apiKey);
    }
    if (enc.hmac && typeof enc.hmac === "string" && !enc.hmac.startsWith("******")) {
        enc.hmac = encryptSecret(enc.hmac);
    }
    if (enc.secretKey && typeof enc.secretKey === "string" && !enc.secretKey.startsWith("******")) {
        enc.secretKey = encryptSecret(enc.secretKey);
    }
    return enc;
};

// Helper: Sanitize credentials record for API responses
const sanitizePaymentCredentialRecord = (record: any) => {
    if (!record) return null;
    let creds = record.credentials;
    if (typeof creds === "string") {
        try {
            creds = JSON.parse(creds);
        } catch {
            creds = {};
        }
    }
    // Auto-heal if previously corrupted with character-spread keys: { 0: '{', 1: '"', ... }
    if (creds && typeof creds === "object" && "0" in creds && !("mid" in creds) && !("apiKey" in creds)) {
        try {
            const reconstructed = Object.keys(creds)
                .sort((a, b) => Number(a) - Number(b))
                .map((k) => creds[k])
                .join("");
            creds = JSON.parse(reconstructed);
        } catch {}
    }
    const safeCreds = creds && typeof creds === "object" ? { ...creds } : {};
    if (safeCreds.apiKey) safeCreds.apiKey = "******";
    if (safeCreds.hmac) safeCreds.hmac = "******";
    if (safeCreds.secretKey) safeCreds.secretKey = "******";
    return {
        ...record,
        credentials: safeCreds,
    };
};

// Helper: increment total_restaurants on a cuisine
const incrementCuisineCount = async (cuisineId: string) => {
    const cuisine = await db
        .select({ total_restaurants: cuisines.total_restaurants })
        .from(cuisines)
        .where(eq(cuisines.id, cuisineId))
        .limit(1);

    if (cuisine[0]) {
        const current = parseInt(cuisine[0].total_restaurants || "0", 10);
        await db
            .update(cuisines)
            .set({ total_restaurants: String(current + 1) })
            .where(eq(cuisines.id, cuisineId));
    }
};

// Helper: decrement total_restaurants on a cuisine
const decrementCuisineCount = async (cuisineId: string) => {
    const cuisine = await db
        .select({ total_restaurants: cuisines.total_restaurants })
        .from(cuisines)
        .where(eq(cuisines.id, cuisineId))
        .limit(1);

    if (cuisine[0]) {
        const current = parseInt(cuisine[0].total_restaurants || "0", 10);
        await db
            .update(cuisines)
            .set({ total_restaurants: String(Math.max(0, current - 1)) })
            .where(eq(cuisines.id, cuisineId));
    }
};

// Helper: Safely parse arrays and extract valid UUIDs only
const safeParseArray = (input: any): string[] => {
    if (!input) return [];
    const stringified = typeof input === "string" ? input : JSON.stringify(input);
    const uuidRegex = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
    const matches = stringified.match(uuidRegex);
    return matches ? Array.from(new Set(matches)) : [];
};

// Helper: map restaurant type to sales points
const getRestaurantTypePoints = (restaurantType?: string | null): number => {
    const normalized = String(restaurantType ?? "").trim().toLowerCase();
    const pointsMap: Record<string, number> = {
        mega: 50,
        super: 25,
        a: 10,
        b: 5,
        c: 2,
        "c-": 1,
    };

    return pointsMap[normalized] ?? 0;
};

// Helper: adjust sales representative points inside a transaction
const adjustSalesRepPoints = async (tx: any, salesId: string | null | undefined, delta: number) => {
    if (!salesId || delta === 0) return;

    const [rep] = await tx
        .select({ points: sales.points })
        .from(sales)
        .where(eq(sales.id, salesId))
        .limit(1);

    if (!rep) return;

    const nextPoints = Math.max(0, Number(rep.points ?? 0) + delta);
    await tx.update(sales).set({ points: nextPoints }).where(eq(sales.id, salesId));
};

// ==========================================
// 1. CREATE RESTAURANT
// ==========================================
export const createRestaurant = async (req: Request, res: Response) => {
    const clean = (v: any) => (typeof v === "string" ? v.trim() : v);

    const {
        name, nameAr, nameFr, address, addressAr, addressFr,
        zoneId, cityId, logo, cover, minDeliveryTime, maxDeliveryTime,
        deliveryTimeUnit, ownerFirstName, ownerLastName, ownerPhone,
        tags, taxNumber, taxExpireDate, taxCertificate, email, password, status,
        lat, lng, deliveryRadiusKm, businessPlans,
        type, salesId, ownerposition, likes, facebookLink, orderLink, deliverystatus, iosApp, androidApp, firstColor, secondColor, firstTextColor, secondTextColor,
        callcenterphone, paymentGatewayType, enableOnlinePayment
    } = req.body;

    let cuisineId = req.body.cuisineId || req.body['cuisineId[]'] || req.body.cuisines || req.body['cuisines[]'];

    if (!name || !nameAr || !nameFr || !logo || !ownerFirstName || !ownerPhone || !email || !password) {
        throw new BadRequest("Missing required fields");
    }

    const restaurantType = (type && clean(type)) ? clean(type) : "C";
    const pointsToAward = getRestaurantTypePoints(restaurantType);

    const existingUser = await db
        .select()
        .from(restrauntadmin)
        .where(eq(restrauntadmin.email, clean(email)))
        .limit(1);

    if (existingUser[0]) throw new BadRequest("Email already exists for a restaurant user");

    let logoUrl: string | undefined = undefined;
    if (logo) logoUrl = (await saveBase64Image(req, logo, "restaurants")).url;

    let coverUrl: string | undefined = undefined;
    if (cover) coverUrl = (await saveBase64Image(req, cover, "restaurants_cover")).url;

    const hashedPassword = await bcrypt.hash(password, 10);
    const restaurantId = uuidv4();
    const ownerUserId = uuidv4();

    const parsedTags: string[] = safeParseArray(tags);
    const parsedCuisines: string[] = safeParseArray(cuisineId);

    let parsedBusinessPlans: any[] = [];
    if (businessPlans) {
        if (typeof businessPlans === "string") {
            try { parsedBusinessPlans = JSON.parse(businessPlans); } catch (e) { parsedBusinessPlans = []; }
        } else if (Array.isArray(businessPlans)) {
            parsedBusinessPlans = businessPlans;
        }
    }

    const paymentCredsRaw = req.body.paymentCredentials ?? req.body.paymentcredition ?? req.body.payment_credentials;
    const parsedPaymentCredentials: any[] = parsePaymentCredentialsInput(paymentCredsRaw);

    // 👈 نوع بوابة الدفع (SYSTEM = حساب المنصة، CUSTOM = حساب خاص بالمطعم)
    const resolvedPaymentGatewayType: "SYSTEM" | "CUSTOM" =
        paymentGatewayType && String(paymentGatewayType).trim().toUpperCase() === "CUSTOM"
            ? "CUSTOM"
            : "SYSTEM";

    // 👈 تفعيل/تعطيل الدفع أونلاين (افتراضي: مفعّل)
    const resolvedEnableOnlinePayment =
        enableOnlinePayment === true || enableOnlinePayment === "true" || enableOnlinePayment === undefined
            ? true
            : Boolean(enableOnlinePayment);

    // 👈 لو النوع CUSTOM لازم يبعت بيانات بوابة دفع واحدة على الأقل
    if (resolvedPaymentGatewayType === "CUSTOM" && parsedPaymentCredentials.length === 0) {
        throw new BadRequest("paymentCredentials are required when paymentGatewayType is CUSTOM");
    }

    const plansToReturn: any[] = []; // 👈 مصفوفة لتجميع الخطط وإرجاعها
    const credentialsToReturn: any[] = []; // 👈 مصفوفة لتجميع بيانات بوابات الدفع وإرجاعها

    await db.transaction(async (tx) => {
        // 1. إنشاء المطعم
        await tx.insert(restaurants).values({
            id: restaurantId,
            name: clean(name),
            nameAr: clean(nameAr),
            nameFr: clean(nameFr),
            address: clean(address),
            addressAr: clean(addressAr),
            addressFr: clean(addressFr),
            cuisineId: parsedCuisines,
            zoneId: zoneId ? clean(zoneId) : null,
            cityId: cityId ? clean(cityId) : null,

            type: restaurantType, // 👈 حفظ نوع المطعم (Default C)
            salesId: salesId ? clean(salesId) : null, // 👈 حفظ الـ Sales ID
            ownerposition: ownerposition ? clean(ownerposition) : null, // 👈 حفظ منصب المالك
            callcenterphone: callcenterphone ? clean(callcenterphone) : null,

            logo: logoUrl || '',
            cover: coverUrl || '',
            lat: lat || '',
            lng: lng || '',
            deliveryRadiusKm: deliveryRadiusKm ? clean(deliveryRadiusKm) : null,
            minDeliveryTime: minDeliveryTime ? clean(minDeliveryTime) : null,
            maxDeliveryTime: maxDeliveryTime ? clean(maxDeliveryTime) : null,
            deliveryTimeUnit: deliveryTimeUnit || "Minutes",
            ownerFirstName: clean(ownerFirstName),
            ownerLastName: clean(ownerLastName),
            ownerPhone: clean(ownerPhone),
            tags: parsedTags,
            taxNumber: taxNumber ? clean(taxNumber) : null,
            taxExpireDate: taxExpireDate || null,
            taxCertificate: typeof taxCertificate === 'string' ? clean(taxCertificate) : null,
            status: status || "active",
            likes: likes || 0,
            facebookLink: facebookLink ? facebookLink.trim() : null,
            orderLink: orderLink ? orderLink.trim() : null,
            deliverystatus: deliverystatus || "not_delivered",
            iosApp: iosApp || '',
            androidApp: androidApp || '',
        });

        // 2. إنشاء المالك
        await tx.insert(restrauntadmin).values({
            id: ownerUserId,
            restaurantId: restaurantId,
            name: `${clean(ownerFirstName)} ${clean(ownerLastName)}`,
            email: clean(email),
            password: hashedPassword,
            phoneNumber: clean(ownerPhone),
            type: "owner",
            status: "active",
        });

        // 3. محفظة المطعم
        await tx.insert(restaurantWallets).values({
            id: uuidv4(),
            restaurantId: restaurantId,
            balance: "0.00",
            collectedCash: "0.00",
            pendingWithdraw: "0.00",
            totalWithdrawn: "0.00",
            totalEarning: "0.00",
        });

        // 4. الـ Business Plans
        if (parsedBusinessPlans.length > 0) {
            for (const plan of parsedBusinessPlans) {
                if (!plan.platformType) continue;

                const newPlan = {
                    id: uuidv4(),
                    restaurantId: restaurantId,
                    platformType: plan.platformType,
                    isMonthlyActive: plan.isMonthlyActive === true || plan.isMonthlyActive === "true",
                    monthlyAmount: plan.monthlyAmount ? String(plan.monthlyAmount) : "0.00",
                    isQuarterlyActive: plan.isQuarterlyActive === true || plan.isQuarterlyActive === "true",
                    quarterlyAmount: plan.quarterlyAmount ? String(plan.quarterlyAmount) : "0.00",
                    isAnnuallyActive: plan.isAnnuallyActive === true || plan.isAnnuallyActive === "true",
                    annuallyAmount: plan.annuallyAmount ? String(plan.annuallyAmount) : "0.00",
                    commissionRate: plan.commissionRate ? String(plan.commissionRate) : "0.00",
                    serviceFee: plan.serviceFee ? String(plan.serviceFee) : "0.00",
                    // حالة المنصة (خاصة بـ food_aggregator و mykeeto)
                    aggregatorStatus: (plan.aggregatorStatus === "inactive" ? "inactive" : "active") as "active" | "inactive",
                    mykeetoStatus: (plan.mykeetoStatus === "inactive" ? "inactive" : "active") as "active" | "inactive",
                };

                await tx.insert(restaurantBusinessPlans).values(newPlan);
                plansToReturn.push(newPlan); // إضافة الخطة للمصفوفة الراجعة
            }
        }

        await tx.insert(restaurantSettings).values({
            restaurantId,
            firstColor: firstColor ? clean(firstColor) : null,
            secondColor: secondColor ? clean(secondColor) : null,
            firstTextColor: firstTextColor ? clean(firstTextColor) : null,
            secondTextColor: secondTextColor ? clean(secondTextColor) : null,
            paymentGatewayType: resolvedPaymentGatewayType, // 👈 نوع بوابة الدفع
            enableOnlinePayment: resolvedEnableOnlinePayment, // 👈 تفعيل الدفع أونلاين
        });

        // 5. بيانات بوابات الدفع (Payment Credentials)
        if (parsedPaymentCredentials.length > 0) {
            for (const credItem of parsedPaymentCredentials) {
                if (!credItem.provider && !credItem.credentials && !credItem.apiKey && !credItem.mid) continue;
                const provider = (credItem.provider || (credItem.mid ? "KASHIER" : "PAYMOB")).toUpperCase() as "PAYMOB" | "KASHIER";
                const title = credItem.title || provider;
                const environment = (credItem.environment || "LIVE").toUpperCase() as "LIVE" | "TEST";
                const rawCreds = extractRawCredentials(credItem);
                const encryptedCreds = encryptCredFields(rawCreds);
                const credId = uuidv4();
                const isActiveFlag = credItem.isActive !== undefined ? Boolean(credItem.isActive) : true;
                const newRecord = {
                    id: credId,
                    restaurantId: restaurantId,
                    provider,
                    title,
                    environment,
                    credentials: encryptedCreds,
                    logoUrl: credItem.logoUrl || null,
                    isActive: isActiveFlag,
                };
                await tx.insert(restaurantPaymentCredentials).values(newRecord);
                credentialsToReturn.push(sanitizePaymentCredentialRecord(newRecord));

                // 👈 لو دي البوابة النشطة، اعمل تعطيل لأي بوابة تانية للمطعم ده
                if (isActiveFlag) {
                    await tx
                        .update(restaurantPaymentCredentials)
                        .set({ isActive: false, updatedAt: new Date() })
                        .where(
                            and(
                                eq(restaurantPaymentCredentials.restaurantId, restaurantId),
                                sql`${restaurantPaymentCredentials.id} != ${credId}`
                            )
                        );
                    // خلي الشكل الراجع متسق مع اللي حصل في الداتابيز
                    for (const c of credentialsToReturn) {
                        if (c.id !== credId) c.isActive = false;
                    }
                }
            }
        }

        await adjustSalesRepPoints(tx, salesId ? clean(salesId) : null, pointsToAward);
    });

    for (const cid of parsedCuisines) await incrementCuisineCount(cid);

    return SuccessResponse(res, {
        message: "Restaurant, Owner account, Business Plans, and Payment Credentials created successfully",
        data: {
            restaurantId,
            ownerUserId,
            type: restaurantType,
            salesId: salesId || null,
            ownerposition: ownerposition || null,
            callcenterphone: callcenterphone || null,
            paymentGatewayType: resolvedPaymentGatewayType,
            enableOnlinePayment: resolvedEnableOnlinePayment,
            businessPlans: plansToReturn,
            paymentCredentials: credentialsToReturn,
        }
    }, 201);
};

// ==========================================
// 2. GET ALL RESTAURANTS
// ==========================================
export const getAllRestaurants = async (req: Request, res: Response) => {
    const raw = await db.select({
        id: restaurants.id,
        name: restaurants.name,
        nameAr: restaurants.nameAr,
        nameFr: restaurants.nameFr,
        address: restaurants.address,
        addressAr: restaurants.addressAr,
        addressFr: restaurants.addressFr,
        logo: restaurants.logo,
        deliveryRadiusKm: restaurants.deliveryRadiusKm,
        lat: restaurants.lat,
        lng: restaurants.lng,
        cover: restaurants.cover,
        status: restaurants.status,
        type: restaurants.type, // 👈 استرجاع النوع
        salesId: restaurants.salesId, // 👈 استرجاع المندوب
        ownerposition: restaurants.ownerposition, // 👈 استرجاع منصب المالك
        callcenterphone: restaurants.callcenterphone,
        cuisineIds: restaurants.cuisineId,
        email: restrauntadmin.email,
        city: { id: cities.id, name: cities.name, nameAr: cities.nameAr, nameFr: cities.nameFr },
        zone_id: zones.id,
        zone_name: zones.name,
        likes: restaurants.likes,
        facebookLink: restaurants.facebookLink,
        orderLink: restaurants.orderLink,
        deliverystatus: restaurants.deliverystatus,
        iosApp: restaurants.iosApp,
        androidApp: restaurants.androidApp,
        paymentGatewayType: restaurantSettings.paymentGatewayType, // 👈 نوع بوابة الدفع
        enableOnlinePayment: restaurantSettings.enableOnlinePayment, // 👈 تفعيل الدفع أونلاين
    })
        .from(restaurants)
        .leftJoin(cities, eq(restaurants.cityId, cities.id))
        .leftJoin(zones, eq(restaurants.zoneId, zones.id))
        .leftJoin(restaurantSettings, eq(restaurants.id, restaurantSettings.restaurantId))
        .leftJoin(
            restrauntadmin,
            and(
                eq(restaurants.id, restrauntadmin.restaurantId),
                eq(restrauntadmin.type, "owner")
            )
        );

    const allCuisinesList = await db.select({
        id: cuisines.id,
        name: cuisines.name,
        nameAr: cuisines.nameAr,
        nameFr: cuisines.nameFr
    }).from(cuisines);
    const cuisineMap = new Map(allCuisinesList.map(c => [String(c.id).toLowerCase(), c]));

    const allBusinessPlansList = await db.select().from(restaurantBusinessPlans);
    const plansMap = new Map();
    for (const plan of allBusinessPlansList) {
        if (!plansMap.has(plan.restaurantId)) plansMap.set(plan.restaurantId, []);
        plansMap.get(plan.restaurantId).push(plan);
    }

    const allPaymentCredentialsList = await db.select().from(restaurantPaymentCredentials);
    const paymentCredentialsMap = new Map<string, any[]>();
    for (const cred of allPaymentCredentialsList) {
        if (!paymentCredentialsMap.has(cred.restaurantId)) paymentCredentialsMap.set(cred.restaurantId, []);
        paymentCredentialsMap.get(cred.restaurantId)!.push(sanitizePaymentCredentialRecord(cred));
    }

    const formatted = raw.map(r => {
        let parsedCuisines = safeParseArray(r.cuisineIds);
        return {
            id: r.id,
            name: r.name,
            nameAr: r.nameAr,
            nameFr: r.nameFr,
            address: r.address,
            addressAr: r.addressAr,
            addressFr: r.addressFr,
            logo: r.logo,
            cover: r.cover,
            status: r.status,
            type: r.type,
            salesId: r.salesId,
            ownerposition: r.ownerposition,
            callcenterphone: r.callcenterphone || null,
            email: r.email || null,
            deliveryRadiusKm: r.deliveryRadiusKm,
            lat: r.lat,
            lng: r.lng,
            cuisines: parsedCuisines.map((id: string) => cuisineMap.get(id.toLowerCase())).filter(Boolean),
            businessPlans: plansMap.get(r.id) || [],
            paymentCredentials: paymentCredentialsMap.get(r.id) || [],
            zone: r.zone_id ? { id: r.zone_id, name: r.zone_name } : null,
            city: r.city ? { id: r.city.id, name: r.city.name, nameAr: r.city.nameAr, nameFr: r.city.nameFr } : null,
            likes: r.likes,
            facebookLink: r.facebookLink || null,
            orderLink: r.orderLink || null,
            deliverystatus: r.deliverystatus,
            iosApp: r.iosApp || null,
            androidApp: r.androidApp || null,
            paymentGatewayType: r.paymentGatewayType || "SYSTEM", // 👈
            enableOnlinePayment: r.enableOnlinePayment ?? true, // 👈
        };
    });

    return SuccessResponse(res, { message: "Get all restaurants success", data: formatted });
};

// ==========================================
// 3. GET RESTAURANT BY ID
// ==========================================
export const getRestaurantById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const rawRestaurants = await db
        .select({
            restaurantObj: restaurants,
            zoneObj: zones,
            cityObj: cities,
            salesObj: sales,
            ownerEmail: restrauntadmin.email,
            settingsObj: restaurantSettings,
        })
        .from(restaurants)
        .leftJoin(zones, eq(restaurants.zoneId, zones.id))
        .leftJoin(sales, eq(restaurants.salesId, sales.id))
        .leftJoin(cities, eq(restaurants.cityId, cities.id))
        .leftJoin(
            restrauntadmin,
            and(eq(restaurants.id, restrauntadmin.restaurantId), eq(restrauntadmin.type, "owner"))
        )
        .leftJoin(restaurantSettings, eq(restaurants.id, restaurantSettings.restaurantId))
        .where(eq(restaurants.id, id))
        .limit(1);

    if (!rawRestaurants[0]) throw new NotFound("Restaurant not found");

    const row = rawRestaurants[0];
    let parsedCuisines = safeParseArray(row.restaurantObj.cuisineId);

    let restaurantCuisines: any[] = [];
    if (parsedCuisines.length > 0) {
        restaurantCuisines = await db
            .select({ id: cuisines.id, name: cuisines.name, nameAr: cuisines.nameAr, nameFr: cuisines.nameFr })
            .from(cuisines)
            .where(inArray(cuisines.id, parsedCuisines));
    }

    const restaurantPlans = await db
        .select()
        .from(restaurantBusinessPlans)
        .where(eq(restaurantBusinessPlans.restaurantId, id));

    const restaurantCreds = await db
        .select()
        .from(restaurantPaymentCredentials)
        .where(eq(restaurantPaymentCredentials.restaurantId, id));
    const sanitizedCreds = restaurantCreds.map(sanitizePaymentCredentialRecord);

    const formattedRestaurant = {
        ...row.restaurantObj,
        type: row.restaurantObj.type,
        ownerposition: row.restaurantObj.ownerposition,
        sales: row.salesObj ? { id: row.salesObj.id, name: row.salesObj.name } : null,
        email: row.ownerEmail || null,
        cuisines: restaurantCuisines,
        businessPlans: restaurantPlans,
        paymentCredentials: sanitizedCreds,
        zone: row.zoneObj ? { id: row.zoneObj.id, name: row.zoneObj.name } : null,
        city: row.cityObj ? { id: row.cityObj.id, name: row.cityObj.name, nameAr: row.cityObj.nameAr, nameFr: row.cityObj.nameFr } : null,
        firstColor: row.settingsObj?.firstColor || null,
        secondColor: row.settingsObj?.secondColor || null,
        firstTextColor: row.settingsObj?.firstTextColor || null,
        secondTextColor: row.settingsObj?.secondTextColor || null,
        paymentGatewayType: row.settingsObj?.paymentGatewayType || "SYSTEM", // 👈 نوع بوابة الدفع
        enableOnlinePayment: row.settingsObj?.enableOnlinePayment ?? true, // 👈 تفعيل الدفع أونلاين
    };
    delete (formattedRestaurant as any).cuisineId;

    return SuccessResponse(res, { message: "Get restaurant by id success", data: formattedRestaurant });
};

// ==========================================
// 4. UPDATE RESTAURANT
// ==========================================
export const updateRestaurant = async (req: Request, res: Response) => {
    const clean = (v: any) => (typeof v === "string" ? v.trim() : v);
    const { id } = req.params;
    const {
        name, nameAr, nameFr, address, addressAr, addressFr, lat, lng, logo, cover,
        minDeliveryTime, maxDeliveryTime, deliveryTimeUnit,
        ownerFirstName, ownerLastName, ownerPhone, tags,
        taxNumber, taxExpireDate, taxCertificate,
        email, password, confirmPassword, status, deliveryRadiusKm,
        type, salesId, ownerposition, businessPlans, likes, facebookLink, orderLink, deliverystatus, iosApp, androidApp, firstColor, secondColor, firstTextColor, secondTextColor, cityId, zoneId,
        callcenterphone, paymentGatewayType, enableOnlinePayment
    } = req.body;

    let cuisineId = req.body.cuisineId || req.body['cuisineId[]'] || req.body.cuisines || req.body['cuisines[]'];

    const [existingRestaurant] = await db.select().from(restaurants).where(eq(restaurants.id, id)).limit(1);
    if (!existingRestaurant) throw new NotFound("Restaurant not found");

    const [existingOwner] = await db.select().from(restrauntadmin).where(and(eq(restrauntadmin.restaurantId, id), eq(restrauntadmin.type, "owner"))).limit(1);

    const resolvedType = type !== undefined ? (clean(type) || "C") : (existingRestaurant.type || "C");
    const resolvedSalesId = salesId !== undefined ? (salesId === "" || salesId === null ? null : clean(salesId)) : existingRestaurant.salesId;
    const previousType = existingRestaurant.type || "C";
    const previousSalesId = existingRestaurant.salesId || null;
    const shouldAdjustSalesPoints = previousSalesId !== resolvedSalesId || previousType !== resolvedType;

    const restaurantUpdateData: any = { updatedAt: new Date() };
    const ownerUpdateData: any = { updatedAt: new Date() };

    let parsedCuisines: string[] | undefined = undefined;
    if (cuisineId !== undefined) {
        parsedCuisines = safeParseArray(cuisineId);
        if (parsedCuisines && parsedCuisines.length > 0) {
            const existingCuisines = await db.select().from(cuisines).where(inArray(cuisines.id, parsedCuisines));
            if (existingCuisines.length !== parsedCuisines.length) throw new BadRequest("One or more Cuisines not found");
        }
    }

    let parsedBusinessPlans: any[] | undefined = undefined;
    if (businessPlans !== undefined) {
        if (typeof businessPlans === "string") {
            try { parsedBusinessPlans = JSON.parse(businessPlans); } catch (e) { parsedBusinessPlans = []; }
        } else if (Array.isArray(businessPlans)) {
            parsedBusinessPlans = businessPlans;
        }
    }

    const paymentCredsRaw = req.body.paymentCredentials ?? req.body.paymentcredition ?? req.body.payment_credentials;
    const parsedPaymentCredentials: any[] | undefined = paymentCredsRaw !== undefined ? parsePaymentCredentialsInput(paymentCredsRaw) : undefined;

    // 👈 نوع بوابة الدفع (يتحدث فقط لو اتبعت)
    let resolvedPaymentGatewayType: "SYSTEM" | "CUSTOM" | undefined;
    if (paymentGatewayType !== undefined) {
        resolvedPaymentGatewayType = String(paymentGatewayType).trim().toUpperCase() === "CUSTOM" ? "CUSTOM" : "SYSTEM";
    }

    // 👈 تفعيل/تعطيل الدفع أونلاين (يتحدث فقط لو اتبعت)
    let resolvedEnableOnlinePayment: boolean | undefined;
    if (enableOnlinePayment !== undefined) {
        resolvedEnableOnlinePayment = enableOnlinePayment === true || enableOnlinePayment === "true";
    }

    if (email && existingOwner && email !== existingOwner.email) {
        const [emailExists] = await db.select().from(restrauntadmin).where(eq(restrauntadmin.email, email.trim())).limit(1);
        if (emailExists) throw new BadRequest("Email already exists for another user");
    }

    if (password && password !== confirmPassword) throw new BadRequest("Password and confirm password do not match");

    if (name) restaurantUpdateData.name = name;
    if (nameAr) restaurantUpdateData.nameAr = nameAr;
    if (nameFr) restaurantUpdateData.nameFr = nameFr;
    if (address) restaurantUpdateData.address = address;
    if (addressAr) restaurantUpdateData.addressAr = addressAr;
    if (addressFr) restaurantUpdateData.addressFr = addressFr;
    if (parsedCuisines !== undefined) restaurantUpdateData.cuisineId = parsedCuisines;

    if (lat !== undefined) restaurantUpdateData.lat = lat;
    if (lng !== undefined) restaurantUpdateData.lng = lng;
    if (deliveryRadiusKm !== undefined) restaurantUpdateData.deliveryRadiusKm = deliveryRadiusKm;

    if (type !== undefined) restaurantUpdateData.type = resolvedType; // 👈 تحديث النوع
    if (salesId !== undefined) restaurantUpdateData.salesId = resolvedSalesId; // 👈 تحديث المندوب
    if (ownerposition !== undefined) restaurantUpdateData.ownerposition = (ownerposition === "" || ownerposition === null) ? null : ownerposition; // 👈 تحديث منصب المالك
    if (callcenterphone !== undefined) restaurantUpdateData.callcenterphone = (callcenterphone === "" || callcenterphone === null) ? null : clean(callcenterphone);

    if (logo) restaurantUpdateData.logo = await handleImageUpdate(req, existingRestaurant.logo, logo, "restaurants");
    if (cover !== undefined) {
        restaurantUpdateData.cover = (cover === "" || cover === null) ? "" : await handleImageUpdate(req, existingRestaurant.cover, cover, "restaurants_cover");
    }

    if (minDeliveryTime !== undefined) restaurantUpdateData.minDeliveryTime = minDeliveryTime;
    if (maxDeliveryTime !== undefined) restaurantUpdateData.maxDeliveryTime = maxDeliveryTime;
    if (deliveryTimeUnit) restaurantUpdateData.deliveryTimeUnit = deliveryTimeUnit;

    if (ownerFirstName) restaurantUpdateData.ownerFirstName = ownerFirstName;
    if (ownerLastName) restaurantUpdateData.ownerLastName = ownerLastName;
    if (ownerPhone) restaurantUpdateData.ownerPhone = ownerPhone;

    if (tags !== undefined) restaurantUpdateData.tags = safeParseArray(tags);
    if (taxNumber !== undefined) restaurantUpdateData.taxNumber = taxNumber;
    if (taxExpireDate !== undefined) restaurantUpdateData.taxExpireDate = taxExpireDate;
    if (taxCertificate !== undefined) restaurantUpdateData.taxCertificate = taxCertificate;
    if (status) restaurantUpdateData.status = status;
    if (likes !== undefined) restaurantUpdateData.likes = Number(likes);
    if (facebookLink !== undefined) restaurantUpdateData.facebookLink = (facebookLink === "" || facebookLink === null) ? null : facebookLink.trim();
    if (orderLink !== undefined) restaurantUpdateData.orderLink = (orderLink === "" || orderLink === null) ? null : orderLink.trim();

    if (email) ownerUpdateData.email = email.trim();
    if (password) ownerUpdateData.password = await bcrypt.hash(password, 10);
    if (status) ownerUpdateData.status = status;
    if (deliverystatus) restaurantUpdateData.deliverystatus = deliverystatus;

    if (ownerFirstName || ownerLastName) {
        const fName = ownerFirstName || existingRestaurant.ownerFirstName;
        const lName = ownerLastName || existingRestaurant.ownerLastName;
        ownerUpdateData.name = `${fName} ${lName}`;
    }
    if (ownerPhone) ownerUpdateData.phoneNumber = ownerPhone;

    if (iosApp !== undefined) restaurantUpdateData.iosApp = iosApp;
    if (androidApp !== undefined) restaurantUpdateData.androidApp = androidApp;

    if (cityId !== undefined) restaurantUpdateData.cityId = (cityId && clean(cityId)) ? clean(cityId) : null;
    if (zoneId !== undefined) restaurantUpdateData.zoneId = (zoneId && clean(zoneId)) ? clean(zoneId) : null;

    await db.transaction(async (tx) => {
        if (Object.keys(restaurantUpdateData).length > 1) {
            await tx.update(restaurants).set(restaurantUpdateData).where(eq(restaurants.id, id));
        }

        if (existingOwner && Object.keys(ownerUpdateData).length > 1) {
            await tx.update(restrauntadmin).set(ownerUpdateData).where(eq(restrauntadmin.id, existingOwner.id));
        }

        if (
            firstColor !== undefined || secondColor !== undefined ||
            firstTextColor !== undefined || secondTextColor !== undefined ||
            resolvedPaymentGatewayType !== undefined || resolvedEnableOnlinePayment !== undefined
        ) {
            const settingsUpdateData: any = {};
            if (firstColor !== undefined) settingsUpdateData.firstColor = (firstColor === "" || firstColor === null) ? null : clean(firstColor);
            if (secondColor !== undefined) settingsUpdateData.secondColor = (secondColor === "" || secondColor === null) ? null : clean(secondColor);
            if (firstTextColor !== undefined) settingsUpdateData.firstTextColor = (firstTextColor === "" || firstTextColor === null) ? null : clean(firstTextColor);
            if (secondTextColor !== undefined) settingsUpdateData.secondTextColor = (secondTextColor === "" || secondTextColor === null) ? null : clean(secondTextColor);
            if (resolvedPaymentGatewayType !== undefined) settingsUpdateData.paymentGatewayType = resolvedPaymentGatewayType; // 👈
            if (resolvedEnableOnlinePayment !== undefined) settingsUpdateData.enableOnlinePayment = resolvedEnableOnlinePayment; // 👈

            if (Object.keys(settingsUpdateData).length > 0) {
                const existingSettings = await tx.select().from(restaurantSettings).where(eq(restaurantSettings.restaurantId, id)).limit(1);
                if (existingSettings.length > 0) {
                    await tx.update(restaurantSettings).set(settingsUpdateData).where(eq(restaurantSettings.restaurantId, id));
                } else {
                    await tx.insert(restaurantSettings).values({ ...settingsUpdateData, restaurantId: id });
                }
            }
        }

        // 👈 تحديث خطط البيزنس (مسح القديم وإدخال الجديد لتجنب التعقيد)
        if (parsedBusinessPlans !== undefined) {
            await tx.delete(restaurantBusinessPlans).where(eq(restaurantBusinessPlans.restaurantId, id));

            if (parsedBusinessPlans.length > 0) {
                for (const plan of parsedBusinessPlans) {
                    if (!plan.platformType) continue;
                    await tx.insert(restaurantBusinessPlans).values({
                        id: uuidv4(),
                        restaurantId: id,
                        platformType: plan.platformType,
                        isMonthlyActive: plan.isMonthlyActive === true || plan.isMonthlyActive === "true",
                        monthlyAmount: plan.monthlyAmount ? String(plan.monthlyAmount) : "0.00",
                        isQuarterlyActive: plan.isQuarterlyActive === true || plan.isQuarterlyActive === "true",
                        quarterlyAmount: plan.quarterlyAmount ? String(plan.quarterlyAmount) : "0.00",
                        isAnnuallyActive: plan.isAnnuallyActive === true || plan.isAnnuallyActive === "true",
                        annuallyAmount: plan.annuallyAmount ? String(plan.annuallyAmount) : "0.00",
                        commissionRate: plan.commissionRate ? String(plan.commissionRate) : "0.00",
                        serviceFee: plan.serviceFee ? String(plan.serviceFee) : "0.00",
                        // حالة المنصة (خاصة بـ food_aggregator و mykeeto)
                        aggregatorStatus: plan.aggregatorStatus === "inactive" ? "inactive" : "active",
                        mykeetoStatus: plan.mykeetoStatus === "inactive" ? "inactive" : "active",
                    });
                }
            }
        }

        // 👈 تحديث بيانات بوابات الدفع (Payment Credentials)
        if (parsedPaymentCredentials !== undefined) {
            for (const credItem of parsedPaymentCredentials) {
                if (!credItem.provider && !credItem.credentials && !credItem.apiKey && !credItem.mid) continue;
                const provider = (credItem.provider || (credItem.mid ? "KASHIER" : "PAYMOB")).toUpperCase() as "PAYMOB" | "KASHIER";
                const title = credItem.title || provider;
                const environment = (credItem.environment || "LIVE").toUpperCase() as "LIVE" | "TEST";
                const rawCreds = extractRawCredentials(credItem);

                let existingRecord = null;
                if (credItem.id) {
                    const [foundById] = await tx
                        .select()
                        .from(restaurantPaymentCredentials)
                        .where(
                            and(
                                eq(restaurantPaymentCredentials.id, credItem.id),
                                eq(restaurantPaymentCredentials.restaurantId, id)
                            )
                        )
                        .limit(1);
                    existingRecord = foundById;
                }
                if (!existingRecord) {
                    const [foundByProvider] = await tx
                        .select()
                        .from(restaurantPaymentCredentials)
                        .where(
                            and(
                                eq(restaurantPaymentCredentials.restaurantId, id),
                                eq(restaurantPaymentCredentials.provider, provider)
                            )
                        )
                        .limit(1);
                    existingRecord = foundByProvider;
                }

                let savedRecordId: string;

                if (existingRecord) {
                    const existingCreds = extractRawCredentials(existingRecord);
                    const mergedCreds = {
                        ...existingCreds,
                        ...rawCreds,
                    };
                    const encryptedCreds = encryptCredFields(mergedCreds);
                    const updatePayload: Record<string, any> = {
                        provider,
                        title,
                        environment,
                        credentials: encryptedCreds,
                        updatedAt: new Date(),
                    };
                    if (credItem.logoUrl !== undefined) updatePayload.logoUrl = credItem.logoUrl || null;
                    if (credItem.isActive !== undefined) updatePayload.isActive = Boolean(credItem.isActive);

                    await tx
                        .update(restaurantPaymentCredentials)
                        .set(updatePayload)
                        .where(eq(restaurantPaymentCredentials.id, existingRecord.id));

                    savedRecordId = existingRecord.id;
                } else {
                    const encryptedCreds = encryptCredFields(rawCreds);
                    const newId = uuidv4();
                    await tx.insert(restaurantPaymentCredentials).values({
                        id: newId,
                        restaurantId: id,
                        provider,
                        title,
                        environment,
                        credentials: encryptedCreds,
                        logoUrl: credItem.logoUrl || null,
                        isActive: credItem.isActive !== undefined ? Boolean(credItem.isActive) : true,
                    });

                    savedRecordId = newId;
                }

                // 👈 لو دي البوابة النشطة، اعمل تعطيل لأي بوابة تانية للمطعم ده
                const finalIsActive = credItem.isActive !== undefined ? Boolean(credItem.isActive) : (existingRecord ? undefined : true);
                if (finalIsActive) {
                    await tx
                        .update(restaurantPaymentCredentials)
                        .set({ isActive: false, updatedAt: new Date() })
                        .where(
                            and(
                                eq(restaurantPaymentCredentials.restaurantId, id),
                                sql`${restaurantPaymentCredentials.id} != ${savedRecordId}`
                            )
                        );
                }
            }
        }

        // 👈 لو النوع بعد التحديث CUSTOM، لازم يبقى فيه بوابة دفع واحدة على الأقل مسجلة فعليًا
        if (resolvedPaymentGatewayType === "CUSTOM") {
            const [{ count }] = await tx
                .select({ count: sql<number>`count(*)` })
                .from(restaurantPaymentCredentials)
                .where(eq(restaurantPaymentCredentials.restaurantId, id));

            if (Number(count) === 0) {
                throw new BadRequest("At least one paymentCredentials record is required when paymentGatewayType is CUSTOM");
            }
        }

        if (shouldAdjustSalesPoints) {
            const previousPoints = getRestaurantTypePoints(previousType);
            const nextPoints = getRestaurantTypePoints(resolvedType);

            if (previousSalesId && previousPoints > 0) {
                await adjustSalesRepPoints(tx, previousSalesId, -previousPoints);
            }

            if (resolvedSalesId && nextPoints > 0) {
                await adjustSalesRepPoints(tx, resolvedSalesId, nextPoints);
            }
        }
    });

    if (parsedCuisines !== undefined) {
        const oldCuisines = safeParseArray(existingRestaurant.cuisineId);
        const newCuisines = parsedCuisines || [];
        for (const cid of oldCuisines) if (!newCuisines.includes(cid)) await decrementCuisineCount(cid);
        for (const cid of newCuisines) if (!oldCuisines.includes(cid)) await incrementCuisineCount(cid);
    }

    return SuccessResponse(res, { message: "Update restaurant, owner account, and plans success" });
};

// ==========================================
// 5. DELETE RESTAURANT
// ==========================================
export const deleteRestaurant = async (req: Request, res: Response) => {
    const { id } = req.params;

    const existingRestaurant = await db.select().from(restaurants).where(eq(restaurants.id, id)).limit(1);
    if (!existingRestaurant[0]) throw new NotFound("Restaurant not found");

    const oldCuisines = safeParseArray(existingRestaurant[0].cuisineId);
    for (const cid of oldCuisines) await decrementCuisineCount(cid);

    await db.transaction(async (tx) => {
        await tx.delete(food).where(eq(food.restaurantid, id));
        await tx.delete(restaurantBusinessPlans).where(eq(restaurantBusinessPlans.restaurantId, id)); // 👈 حذف الخطط
        await tx.delete(restaurantWallets).where(eq(restaurantWallets.restaurantId, id));
        await tx.delete(restrauntadmin).where(eq(restrauntadmin.restaurantId, id));
        await tx.delete(restaurants).where(eq(restaurants.id, id));
    });

    return SuccessResponse(res, { message: "Delete restaurant and all related data success" });
};

// ==========================================
// 6. GET CUISINES AND ZONES
// ==========================================
export const getallcousinesandzones = async (req: Request, res: Response) => {
    const allCuisines = await db.select({ id: cuisines.id, name: cuisines.name }).from(cuisines).where(eq(cuisines.status, "active"));
    const allZones = await db.select({ id: zones.id, name: zones.name }).from(zones).where(eq(zones.status, "active"));
    return SuccessResponse(res, { message: "Get all cuisines and zones success", data: { allCuisines, allZones } });
}

// ==========================================
// 7. GET ALL ACTIVE SALES
// ==========================================
export const getActiveSales = async (req: Request, res: Response) => {
    const activeSales = await db
        .select({ id: sales.id, name: sales.name })
        .from(sales)
        .where(eq(sales.status, "active"));

    // const allCities = await db.select({ id: cities.id, name: cities.name, nameAr: cities.nameAr, nameFr: cities.nameFr }).from(cities).where(eq(cities.status, "active"));

    return SuccessResponse(res, { message: "Get all active sales success", data: activeSales });
};

// ==========================================
// 8. CHANGE DELIVERY STATUS
// ==========================================
export const changeDeliveryStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { deliverystatus } = req.body;

    if (deliverystatus === undefined) {
        throw new BadRequest("deliverystatus is required");
    }

    if (deliverystatus !== "delivered" && deliverystatus !== "not_delivered") {
        throw new BadRequest("deliverystatus must be either 'delivered' or 'not_delivered'");
    }

    const [existingRestaurant] = await db.select().from(restaurants).where(eq(restaurants.id, id)).limit(1);
    if (!existingRestaurant) throw new NotFound("Restaurant not found");

    await db.update(restaurants).set({ deliverystatus, updatedAt: new Date() }).where(eq(restaurants.id, id));

    return SuccessResponse(res, { message: "Delivery status updated successfully" });
};

// ==========================================
// 9. Get Restaurant Select Data
// ==========================================
export const getRestaurantSelectData = async (req: Request, res: Response) => {
    const restaurantSelectData = await db.select({ id: restaurants.id, name: restaurants.name }).from(restaurants).where(eq(restaurants.status, "active"));
    return SuccessResponse(res, { message: "Get all restaurants select data successfully", data: restaurantSelectData });
}
