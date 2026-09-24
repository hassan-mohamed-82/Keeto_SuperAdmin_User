"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRestaurantSelectData = exports.changeDeliveryStatus = exports.getActiveSales = exports.getallcousinesandzones = exports.deleteRestaurant = exports.updateRestaurant = exports.getRestaurantById = exports.getAllRestaurants = exports.createRestaurant = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const NotFound_1 = require("../../Errors/NotFound");
const BadRequest_1 = require("../../Errors/BadRequest");
const bcrypt_1 = __importDefault(require("bcrypt"));
const uuid_1 = require("uuid");
const handleImages_1 = require("../../utils/handleImages");
const encryption_1 = require("../../utils/encryption");
// Helper: Parse payment credentials from request body (accepts array, single object, or JSON string)
const parsePaymentCredentialsInput = (input) => {
    if (!input)
        return [];
    let parsed = input;
    if (typeof input === "string") {
        try {
            parsed = JSON.parse(input);
        }
        catch {
            return [];
        }
    }
    if (Array.isArray(parsed)) {
        return parsed;
    }
    else if (typeof parsed === "object" && parsed !== null) {
        return [parsed];
    }
    return [];
};
// Helper: Encrypt sensitive fields in payment credentials
const encryptCredFields = (creds) => {
    const enc = { ...creds };
    if (enc.apiKey && typeof enc.apiKey === "string" && !enc.apiKey.startsWith("******")) {
        enc.apiKey = (0, encryption_1.encryptSecret)(enc.apiKey);
    }
    if (enc.hmac && typeof enc.hmac === "string" && !enc.hmac.startsWith("******")) {
        enc.hmac = (0, encryption_1.encryptSecret)(enc.hmac);
    }
    if (enc.secretKey && typeof enc.secretKey === "string" && !enc.secretKey.startsWith("******")) {
        enc.secretKey = (0, encryption_1.encryptSecret)(enc.secretKey);
    }
    return enc;
};
// Helper: Sanitize credentials record for API responses
const sanitizePaymentCredentialRecord = (record) => {
    if (!record)
        return null;
    const creds = record.credentials ? { ...record.credentials } : {};
    if (creds.apiKey)
        creds.apiKey = "******";
    if (creds.hmac)
        creds.hmac = "******";
    if (creds.secretKey)
        creds.secretKey = "******";
    return {
        ...record,
        credentials: creds,
    };
};
// Helper: increment total_restaurants on a cuisine
const incrementCuisineCount = async (cuisineId) => {
    const cuisine = await connection_1.db
        .select({ total_restaurants: schema_1.cuisines.total_restaurants })
        .from(schema_1.cuisines)
        .where((0, drizzle_orm_1.eq)(schema_1.cuisines.id, cuisineId))
        .limit(1);
    if (cuisine[0]) {
        const current = parseInt(cuisine[0].total_restaurants || "0", 10);
        await connection_1.db
            .update(schema_1.cuisines)
            .set({ total_restaurants: String(current + 1) })
            .where((0, drizzle_orm_1.eq)(schema_1.cuisines.id, cuisineId));
    }
};
// Helper: decrement total_restaurants on a cuisine
const decrementCuisineCount = async (cuisineId) => {
    const cuisine = await connection_1.db
        .select({ total_restaurants: schema_1.cuisines.total_restaurants })
        .from(schema_1.cuisines)
        .where((0, drizzle_orm_1.eq)(schema_1.cuisines.id, cuisineId))
        .limit(1);
    if (cuisine[0]) {
        const current = parseInt(cuisine[0].total_restaurants || "0", 10);
        await connection_1.db
            .update(schema_1.cuisines)
            .set({ total_restaurants: String(Math.max(0, current - 1)) })
            .where((0, drizzle_orm_1.eq)(schema_1.cuisines.id, cuisineId));
    }
};
// Helper: Safely parse arrays and extract valid UUIDs only
const safeParseArray = (input) => {
    if (!input)
        return [];
    const stringified = typeof input === "string" ? input : JSON.stringify(input);
    const uuidRegex = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
    const matches = stringified.match(uuidRegex);
    return matches ? Array.from(new Set(matches)) : [];
};
// Helper: map restaurant type to sales points
const getRestaurantTypePoints = (restaurantType) => {
    const normalized = String(restaurantType ?? "").trim().toLowerCase();
    const pointsMap = {
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
const adjustSalesRepPoints = async (tx, salesId, delta) => {
    if (!salesId || delta === 0)
        return;
    const [rep] = await tx
        .select({ points: schema_1.sales.points })
        .from(schema_1.sales)
        .where((0, drizzle_orm_1.eq)(schema_1.sales.id, salesId))
        .limit(1);
    if (!rep)
        return;
    const nextPoints = Math.max(0, Number(rep.points ?? 0) + delta);
    await tx.update(schema_1.sales).set({ points: nextPoints }).where((0, drizzle_orm_1.eq)(schema_1.sales.id, salesId));
};
// ==========================================
// 1. CREATE RESTAURANT
// ==========================================
const createRestaurant = async (req, res) => {
    const clean = (v) => (typeof v === "string" ? v.trim() : v);
    const { name, nameAr, nameFr, address, addressAr, addressFr, zoneId, cityId, logo, cover, minDeliveryTime, maxDeliveryTime, deliveryTimeUnit, ownerFirstName, ownerLastName, ownerPhone, tags, taxNumber, taxExpireDate, taxCertificate, email, password, status, lat, lng, deliveryRadiusKm, businessPlans, type, salesId, ownerposition, likes, facebookLink, orderLink, deliverystatus, iosApp, androidApp, firstColor, secondColor, firstTextColor, secondTextColor, callcenterphone, paymentGatewayType, enableOnlinePayment } = req.body;
    let cuisineId = req.body.cuisineId || req.body['cuisineId[]'] || req.body.cuisines || req.body['cuisines[]'];
    if (!name || !nameAr || !nameFr || !logo || !ownerFirstName || !ownerPhone || !email || !password) {
        throw new BadRequest_1.BadRequest("Missing required fields");
    }
    const restaurantType = (type && clean(type)) ? clean(type) : "C";
    const pointsToAward = getRestaurantTypePoints(restaurantType);
    const existingUser = await connection_1.db
        .select()
        .from(schema_1.restrauntadmin)
        .where((0, drizzle_orm_1.eq)(schema_1.restrauntadmin.email, clean(email)))
        .limit(1);
    if (existingUser[0])
        throw new BadRequest_1.BadRequest("Email already exists for a restaurant user");
    let logoUrl = undefined;
    if (logo)
        logoUrl = (await (0, handleImages_1.saveBase64Image)(req, logo, "restaurants")).url;
    let coverUrl = undefined;
    if (cover)
        coverUrl = (await (0, handleImages_1.saveBase64Image)(req, cover, "restaurants_cover")).url;
    const hashedPassword = await bcrypt_1.default.hash(password, 10);
    const restaurantId = (0, uuid_1.v4)();
    const ownerUserId = (0, uuid_1.v4)();
    const parsedTags = safeParseArray(tags);
    const parsedCuisines = safeParseArray(cuisineId);
    let parsedBusinessPlans = [];
    if (businessPlans) {
        if (typeof businessPlans === "string") {
            try {
                parsedBusinessPlans = JSON.parse(businessPlans);
            }
            catch (e) {
                parsedBusinessPlans = [];
            }
        }
        else if (Array.isArray(businessPlans)) {
            parsedBusinessPlans = businessPlans;
        }
    }
    const paymentCredsRaw = req.body.paymentCredentials ?? req.body.paymentcredition ?? req.body.payment_credentials;
    const parsedPaymentCredentials = parsePaymentCredentialsInput(paymentCredsRaw);
    // 👈 نوع بوابة الدفع (SYSTEM = حساب المنصة، CUSTOM = حساب خاص بالمطعم)
    const resolvedPaymentGatewayType = paymentGatewayType && String(paymentGatewayType).trim().toUpperCase() === "CUSTOM"
        ? "CUSTOM"
        : "SYSTEM";
    // 👈 تفعيل/تعطيل الدفع أونلاين (افتراضي: مفعّل)
    const resolvedEnableOnlinePayment = enableOnlinePayment === true || enableOnlinePayment === "true" || enableOnlinePayment === undefined
        ? true
        : Boolean(enableOnlinePayment);
    // 👈 لو النوع CUSTOM لازم يبعت بيانات بوابة دفع واحدة على الأقل
    if (resolvedPaymentGatewayType === "CUSTOM" && parsedPaymentCredentials.length === 0) {
        throw new BadRequest_1.BadRequest("paymentCredentials are required when paymentGatewayType is CUSTOM");
    }
    const plansToReturn = []; // 👈 مصفوفة لتجميع الخطط وإرجاعها
    const credentialsToReturn = []; // 👈 مصفوفة لتجميع بيانات بوابات الدفع وإرجاعها
    await connection_1.db.transaction(async (tx) => {
        // 1. إنشاء المطعم
        await tx.insert(schema_1.restaurants).values({
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
        await tx.insert(schema_1.restrauntadmin).values({
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
        await tx.insert(schema_1.restaurantWallets).values({
            id: (0, uuid_1.v4)(),
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
                if (!plan.platformType)
                    continue;
                const newPlan = {
                    id: (0, uuid_1.v4)(),
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
                    aggregatorStatus: (plan.aggregatorStatus === "inactive" ? "inactive" : "active"),
                    mykeetoStatus: (plan.mykeetoStatus === "inactive" ? "inactive" : "active"),
                };
                await tx.insert(schema_1.restaurantBusinessPlans).values(newPlan);
                plansToReturn.push(newPlan); // إضافة الخطة للمصفوفة الراجعة
            }
        }
        await tx.insert(schema_1.restaurantSettings).values({
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
                if (!credItem.provider && !credItem.credentials && !credItem.apiKey && !credItem.mid)
                    continue;
                const provider = (credItem.provider || (credItem.mid ? "KASHIER" : "PAYMOB")).toUpperCase();
                const title = credItem.title || provider;
                const environment = (credItem.environment || "LIVE").toUpperCase();
                const rawCreds = credItem.credentials && typeof credItem.credentials === "object"
                    ? credItem.credentials
                    : {
                        apiKey: credItem.apiKey,
                        hmac: credItem.hmac,
                        integrationId: credItem.integrationId,
                        iframeId: credItem.iframeId,
                        callbackUrl: credItem.callbackUrl,
                        mid: credItem.mid,
                        secretKey: credItem.secretKey,
                        baseUrl: credItem.baseUrl,
                    };
                const encryptedCreds = encryptCredFields(rawCreds);
                const credId = (0, uuid_1.v4)();
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
                await tx.insert(schema_1.restaurantPaymentCredentials).values(newRecord);
                credentialsToReturn.push(sanitizePaymentCredentialRecord(newRecord));
                // 👈 لو دي البوابة النشطة، اعمل تعطيل لأي بوابة تانية للمطعم ده
                if (isActiveFlag) {
                    await tx
                        .update(schema_1.restaurantPaymentCredentials)
                        .set({ isActive: false, updatedAt: new Date() })
                        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.restaurantId, restaurantId), (0, drizzle_orm_1.sql) `${schema_1.restaurantPaymentCredentials.id} != ${credId}`));
                    // خلي الشكل الراجع متسق مع اللي حصل في الداتابيز
                    for (const c of credentialsToReturn) {
                        if (c.id !== credId)
                            c.isActive = false;
                    }
                }
            }
        }
        await adjustSalesRepPoints(tx, salesId ? clean(salesId) : null, pointsToAward);
    });
    for (const cid of parsedCuisines)
        await incrementCuisineCount(cid);
    return (0, response_1.SuccessResponse)(res, {
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
exports.createRestaurant = createRestaurant;
// ==========================================
// 2. GET ALL RESTAURANTS
// ==========================================
const getAllRestaurants = async (req, res) => {
    const raw = await connection_1.db.select({
        id: schema_1.restaurants.id,
        name: schema_1.restaurants.name,
        nameAr: schema_1.restaurants.nameAr,
        nameFr: schema_1.restaurants.nameFr,
        address: schema_1.restaurants.address,
        addressAr: schema_1.restaurants.addressAr,
        addressFr: schema_1.restaurants.addressFr,
        logo: schema_1.restaurants.logo,
        deliveryRadiusKm: schema_1.restaurants.deliveryRadiusKm,
        lat: schema_1.restaurants.lat,
        lng: schema_1.restaurants.lng,
        cover: schema_1.restaurants.cover,
        status: schema_1.restaurants.status,
        type: schema_1.restaurants.type, // 👈 استرجاع النوع
        salesId: schema_1.restaurants.salesId, // 👈 استرجاع المندوب
        ownerposition: schema_1.restaurants.ownerposition, // 👈 استرجاع منصب المالك
        callcenterphone: schema_1.restaurants.callcenterphone,
        cuisineIds: schema_1.restaurants.cuisineId,
        email: schema_1.restrauntadmin.email,
        city: { id: schema_1.cities.id, name: schema_1.cities.name, nameAr: schema_1.cities.nameAr, nameFr: schema_1.cities.nameFr },
        zone_id: schema_1.zones.id,
        zone_name: schema_1.zones.name,
        likes: schema_1.restaurants.likes,
        facebookLink: schema_1.restaurants.facebookLink,
        orderLink: schema_1.restaurants.orderLink,
        deliverystatus: schema_1.restaurants.deliverystatus,
        iosApp: schema_1.restaurants.iosApp,
        androidApp: schema_1.restaurants.androidApp,
        paymentGatewayType: schema_1.restaurantSettings.paymentGatewayType, // 👈 نوع بوابة الدفع
        enableOnlinePayment: schema_1.restaurantSettings.enableOnlinePayment, // 👈 تفعيل الدفع أونلاين
    })
        .from(schema_1.restaurants)
        .leftJoin(schema_1.cities, (0, drizzle_orm_1.eq)(schema_1.restaurants.cityId, schema_1.cities.id))
        .leftJoin(schema_1.zones, (0, drizzle_orm_1.eq)(schema_1.restaurants.zoneId, schema_1.zones.id))
        .leftJoin(schema_1.restaurantSettings, (0, drizzle_orm_1.eq)(schema_1.restaurants.id, schema_1.restaurantSettings.restaurantId))
        .leftJoin(schema_1.restrauntadmin, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurants.id, schema_1.restrauntadmin.restaurantId), (0, drizzle_orm_1.eq)(schema_1.restrauntadmin.type, "owner")));
    const allCuisinesList = await connection_1.db.select({
        id: schema_1.cuisines.id,
        name: schema_1.cuisines.name,
        nameAr: schema_1.cuisines.nameAr,
        nameFr: schema_1.cuisines.nameFr
    }).from(schema_1.cuisines);
    const cuisineMap = new Map(allCuisinesList.map(c => [String(c.id).toLowerCase(), c]));
    const allBusinessPlansList = await connection_1.db.select().from(schema_1.restaurantBusinessPlans);
    const plansMap = new Map();
    for (const plan of allBusinessPlansList) {
        if (!plansMap.has(plan.restaurantId))
            plansMap.set(plan.restaurantId, []);
        plansMap.get(plan.restaurantId).push(plan);
    }
    const allPaymentCredentialsList = await connection_1.db.select().from(schema_1.restaurantPaymentCredentials);
    const paymentCredentialsMap = new Map();
    for (const cred of allPaymentCredentialsList) {
        if (!paymentCredentialsMap.has(cred.restaurantId))
            paymentCredentialsMap.set(cred.restaurantId, []);
        paymentCredentialsMap.get(cred.restaurantId).push(sanitizePaymentCredentialRecord(cred));
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
            cuisines: parsedCuisines.map((id) => cuisineMap.get(id.toLowerCase())).filter(Boolean),
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
    return (0, response_1.SuccessResponse)(res, { message: "Get all restaurants success", data: formatted });
};
exports.getAllRestaurants = getAllRestaurants;
// ==========================================
// 3. GET RESTAURANT BY ID
// ==========================================
const getRestaurantById = async (req, res) => {
    const { id } = req.params;
    const rawRestaurants = await connection_1.db
        .select({
        restaurantObj: schema_1.restaurants,
        zoneObj: schema_1.zones,
        cityObj: schema_1.cities,
        salesObj: schema_1.sales,
        ownerEmail: schema_1.restrauntadmin.email,
        settingsObj: schema_1.restaurantSettings,
    })
        .from(schema_1.restaurants)
        .leftJoin(schema_1.zones, (0, drizzle_orm_1.eq)(schema_1.restaurants.zoneId, schema_1.zones.id))
        .leftJoin(schema_1.sales, (0, drizzle_orm_1.eq)(schema_1.restaurants.salesId, schema_1.sales.id))
        .leftJoin(schema_1.cities, (0, drizzle_orm_1.eq)(schema_1.restaurants.cityId, schema_1.cities.id))
        .leftJoin(schema_1.restrauntadmin, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurants.id, schema_1.restrauntadmin.restaurantId), (0, drizzle_orm_1.eq)(schema_1.restrauntadmin.type, "owner")))
        .leftJoin(schema_1.restaurantSettings, (0, drizzle_orm_1.eq)(schema_1.restaurants.id, schema_1.restaurantSettings.restaurantId))
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, id))
        .limit(1);
    if (!rawRestaurants[0])
        throw new NotFound_1.NotFound("Restaurant not found");
    const row = rawRestaurants[0];
    let parsedCuisines = safeParseArray(row.restaurantObj.cuisineId);
    let restaurantCuisines = [];
    if (parsedCuisines.length > 0) {
        restaurantCuisines = await connection_1.db
            .select({ id: schema_1.cuisines.id, name: schema_1.cuisines.name, nameAr: schema_1.cuisines.nameAr, nameFr: schema_1.cuisines.nameFr })
            .from(schema_1.cuisines)
            .where((0, drizzle_orm_1.inArray)(schema_1.cuisines.id, parsedCuisines));
    }
    const restaurantPlans = await connection_1.db
        .select()
        .from(schema_1.restaurantBusinessPlans)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.restaurantId, id));
    const restaurantCreds = await connection_1.db
        .select()
        .from(schema_1.restaurantPaymentCredentials)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.restaurantId, id));
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
    delete formattedRestaurant.cuisineId;
    return (0, response_1.SuccessResponse)(res, { message: "Get restaurant by id success", data: formattedRestaurant });
};
exports.getRestaurantById = getRestaurantById;
// ==========================================
// 4. UPDATE RESTAURANT
// ==========================================
const updateRestaurant = async (req, res) => {
    const clean = (v) => (typeof v === "string" ? v.trim() : v);
    const { id } = req.params;
    const { name, nameAr, nameFr, address, addressAr, addressFr, lat, lng, logo, cover, minDeliveryTime, maxDeliveryTime, deliveryTimeUnit, ownerFirstName, ownerLastName, ownerPhone, tags, taxNumber, taxExpireDate, taxCertificate, email, password, confirmPassword, status, deliveryRadiusKm, type, salesId, ownerposition, businessPlans, likes, facebookLink, orderLink, deliverystatus, iosApp, androidApp, firstColor, secondColor, firstTextColor, secondTextColor, cityId, zoneId, callcenterphone, paymentGatewayType, enableOnlinePayment } = req.body;
    let cuisineId = req.body.cuisineId || req.body['cuisineId[]'] || req.body.cuisines || req.body['cuisines[]'];
    const [existingRestaurant] = await connection_1.db.select().from(schema_1.restaurants).where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, id)).limit(1);
    if (!existingRestaurant)
        throw new NotFound_1.NotFound("Restaurant not found");
    const [existingOwner] = await connection_1.db.select().from(schema_1.restrauntadmin).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restrauntadmin.restaurantId, id), (0, drizzle_orm_1.eq)(schema_1.restrauntadmin.type, "owner"))).limit(1);
    const resolvedType = type !== undefined ? (clean(type) || "C") : (existingRestaurant.type || "C");
    const resolvedSalesId = salesId !== undefined ? (salesId === "" || salesId === null ? null : clean(salesId)) : existingRestaurant.salesId;
    const previousType = existingRestaurant.type || "C";
    const previousSalesId = existingRestaurant.salesId || null;
    const shouldAdjustSalesPoints = previousSalesId !== resolvedSalesId || previousType !== resolvedType;
    const restaurantUpdateData = { updatedAt: new Date() };
    const ownerUpdateData = { updatedAt: new Date() };
    let parsedCuisines = undefined;
    if (cuisineId !== undefined) {
        parsedCuisines = safeParseArray(cuisineId);
        if (parsedCuisines && parsedCuisines.length > 0) {
            const existingCuisines = await connection_1.db.select().from(schema_1.cuisines).where((0, drizzle_orm_1.inArray)(schema_1.cuisines.id, parsedCuisines));
            if (existingCuisines.length !== parsedCuisines.length)
                throw new BadRequest_1.BadRequest("One or more Cuisines not found");
        }
    }
    let parsedBusinessPlans = undefined;
    if (businessPlans !== undefined) {
        if (typeof businessPlans === "string") {
            try {
                parsedBusinessPlans = JSON.parse(businessPlans);
            }
            catch (e) {
                parsedBusinessPlans = [];
            }
        }
        else if (Array.isArray(businessPlans)) {
            parsedBusinessPlans = businessPlans;
        }
    }
    const paymentCredsRaw = req.body.paymentCredentials ?? req.body.paymentcredition ?? req.body.payment_credentials;
    const parsedPaymentCredentials = paymentCredsRaw !== undefined ? parsePaymentCredentialsInput(paymentCredsRaw) : undefined;
    // 👈 نوع بوابة الدفع (يتحدث فقط لو اتبعت)
    let resolvedPaymentGatewayType;
    if (paymentGatewayType !== undefined) {
        resolvedPaymentGatewayType = String(paymentGatewayType).trim().toUpperCase() === "CUSTOM" ? "CUSTOM" : "SYSTEM";
    }
    // 👈 تفعيل/تعطيل الدفع أونلاين (يتحدث فقط لو اتبعت)
    let resolvedEnableOnlinePayment;
    if (enableOnlinePayment !== undefined) {
        resolvedEnableOnlinePayment = enableOnlinePayment === true || enableOnlinePayment === "true";
    }
    if (email && existingOwner && email !== existingOwner.email) {
        const [emailExists] = await connection_1.db.select().from(schema_1.restrauntadmin).where((0, drizzle_orm_1.eq)(schema_1.restrauntadmin.email, email.trim())).limit(1);
        if (emailExists)
            throw new BadRequest_1.BadRequest("Email already exists for another user");
    }
    if (password && password !== confirmPassword)
        throw new BadRequest_1.BadRequest("Password and confirm password do not match");
    if (name)
        restaurantUpdateData.name = name;
    if (nameAr)
        restaurantUpdateData.nameAr = nameAr;
    if (nameFr)
        restaurantUpdateData.nameFr = nameFr;
    if (address)
        restaurantUpdateData.address = address;
    if (addressAr)
        restaurantUpdateData.addressAr = addressAr;
    if (addressFr)
        restaurantUpdateData.addressFr = addressFr;
    if (parsedCuisines !== undefined)
        restaurantUpdateData.cuisineId = parsedCuisines;
    if (lat !== undefined)
        restaurantUpdateData.lat = lat;
    if (lng !== undefined)
        restaurantUpdateData.lng = lng;
    if (deliveryRadiusKm !== undefined)
        restaurantUpdateData.deliveryRadiusKm = deliveryRadiusKm;
    if (type !== undefined)
        restaurantUpdateData.type = resolvedType; // 👈 تحديث النوع
    if (salesId !== undefined)
        restaurantUpdateData.salesId = resolvedSalesId; // 👈 تحديث المندوب
    if (ownerposition !== undefined)
        restaurantUpdateData.ownerposition = (ownerposition === "" || ownerposition === null) ? null : ownerposition; // 👈 تحديث منصب المالك
    if (callcenterphone !== undefined)
        restaurantUpdateData.callcenterphone = (callcenterphone === "" || callcenterphone === null) ? null : clean(callcenterphone);
    if (logo)
        restaurantUpdateData.logo = await (0, handleImages_1.handleImageUpdate)(req, existingRestaurant.logo, logo, "restaurants");
    if (cover !== undefined) {
        restaurantUpdateData.cover = (cover === "" || cover === null) ? "" : await (0, handleImages_1.handleImageUpdate)(req, existingRestaurant.cover, cover, "restaurants_cover");
    }
    if (minDeliveryTime !== undefined)
        restaurantUpdateData.minDeliveryTime = minDeliveryTime;
    if (maxDeliveryTime !== undefined)
        restaurantUpdateData.maxDeliveryTime = maxDeliveryTime;
    if (deliveryTimeUnit)
        restaurantUpdateData.deliveryTimeUnit = deliveryTimeUnit;
    if (ownerFirstName)
        restaurantUpdateData.ownerFirstName = ownerFirstName;
    if (ownerLastName)
        restaurantUpdateData.ownerLastName = ownerLastName;
    if (ownerPhone)
        restaurantUpdateData.ownerPhone = ownerPhone;
    if (tags !== undefined)
        restaurantUpdateData.tags = safeParseArray(tags);
    if (taxNumber !== undefined)
        restaurantUpdateData.taxNumber = taxNumber;
    if (taxExpireDate !== undefined)
        restaurantUpdateData.taxExpireDate = taxExpireDate;
    if (taxCertificate !== undefined)
        restaurantUpdateData.taxCertificate = taxCertificate;
    if (status)
        restaurantUpdateData.status = status;
    if (likes !== undefined)
        restaurantUpdateData.likes = Number(likes);
    if (facebookLink !== undefined)
        restaurantUpdateData.facebookLink = (facebookLink === "" || facebookLink === null) ? null : facebookLink.trim();
    if (orderLink !== undefined)
        restaurantUpdateData.orderLink = (orderLink === "" || orderLink === null) ? null : orderLink.trim();
    if (email)
        ownerUpdateData.email = email.trim();
    if (password)
        ownerUpdateData.password = await bcrypt_1.default.hash(password, 10);
    if (status)
        ownerUpdateData.status = status;
    if (deliverystatus)
        restaurantUpdateData.deliverystatus = deliverystatus;
    if (ownerFirstName || ownerLastName) {
        const fName = ownerFirstName || existingRestaurant.ownerFirstName;
        const lName = ownerLastName || existingRestaurant.ownerLastName;
        ownerUpdateData.name = `${fName} ${lName}`;
    }
    if (ownerPhone)
        ownerUpdateData.phoneNumber = ownerPhone;
    if (iosApp !== undefined)
        restaurantUpdateData.iosApp = iosApp;
    if (androidApp !== undefined)
        restaurantUpdateData.androidApp = androidApp;
    if (cityId !== undefined)
        restaurantUpdateData.cityId = (cityId && clean(cityId)) ? clean(cityId) : null;
    if (zoneId !== undefined)
        restaurantUpdateData.zoneId = (zoneId && clean(zoneId)) ? clean(zoneId) : null;
    await connection_1.db.transaction(async (tx) => {
        if (Object.keys(restaurantUpdateData).length > 1) {
            await tx.update(schema_1.restaurants).set(restaurantUpdateData).where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, id));
        }
        if (existingOwner && Object.keys(ownerUpdateData).length > 1) {
            await tx.update(schema_1.restrauntadmin).set(ownerUpdateData).where((0, drizzle_orm_1.eq)(schema_1.restrauntadmin.id, existingOwner.id));
        }
        if (firstColor !== undefined || secondColor !== undefined ||
            firstTextColor !== undefined || secondTextColor !== undefined ||
            resolvedPaymentGatewayType !== undefined || resolvedEnableOnlinePayment !== undefined) {
            const settingsUpdateData = {};
            if (firstColor !== undefined)
                settingsUpdateData.firstColor = (firstColor === "" || firstColor === null) ? null : clean(firstColor);
            if (secondColor !== undefined)
                settingsUpdateData.secondColor = (secondColor === "" || secondColor === null) ? null : clean(secondColor);
            if (firstTextColor !== undefined)
                settingsUpdateData.firstTextColor = (firstTextColor === "" || firstTextColor === null) ? null : clean(firstTextColor);
            if (secondTextColor !== undefined)
                settingsUpdateData.secondTextColor = (secondTextColor === "" || secondTextColor === null) ? null : clean(secondTextColor);
            if (resolvedPaymentGatewayType !== undefined)
                settingsUpdateData.paymentGatewayType = resolvedPaymentGatewayType; // 👈
            if (resolvedEnableOnlinePayment !== undefined)
                settingsUpdateData.enableOnlinePayment = resolvedEnableOnlinePayment; // 👈
            if (Object.keys(settingsUpdateData).length > 0) {
                const existingSettings = await tx.select().from(schema_1.restaurantSettings).where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, id)).limit(1);
                if (existingSettings.length > 0) {
                    await tx.update(schema_1.restaurantSettings).set(settingsUpdateData).where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, id));
                }
                else {
                    await tx.insert(schema_1.restaurantSettings).values({ ...settingsUpdateData, restaurantId: id });
                }
            }
        }
        // 👈 تحديث خطط البيزنس (مسح القديم وإدخال الجديد لتجنب التعقيد)
        if (parsedBusinessPlans !== undefined) {
            await tx.delete(schema_1.restaurantBusinessPlans).where((0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.restaurantId, id));
            if (parsedBusinessPlans.length > 0) {
                for (const plan of parsedBusinessPlans) {
                    if (!plan.platformType)
                        continue;
                    await tx.insert(schema_1.restaurantBusinessPlans).values({
                        id: (0, uuid_1.v4)(),
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
                if (!credItem.provider && !credItem.credentials && !credItem.apiKey && !credItem.mid)
                    continue;
                const provider = (credItem.provider || (credItem.mid ? "KASHIER" : "PAYMOB")).toUpperCase();
                const title = credItem.title || provider;
                const environment = (credItem.environment || "LIVE").toUpperCase();
                const rawCreds = credItem.credentials && typeof credItem.credentials === "object"
                    ? credItem.credentials
                    : {
                        apiKey: credItem.apiKey,
                        hmac: credItem.hmac,
                        integrationId: credItem.integrationId,
                        iframeId: credItem.iframeId,
                        callbackUrl: credItem.callbackUrl,
                        mid: credItem.mid,
                        secretKey: credItem.secretKey,
                        baseUrl: credItem.baseUrl,
                    };
                let existingRecord = null;
                if (credItem.id) {
                    const [foundById] = await tx
                        .select()
                        .from(schema_1.restaurantPaymentCredentials)
                        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.id, credItem.id), (0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.restaurantId, id)))
                        .limit(1);
                    existingRecord = foundById;
                }
                if (!existingRecord) {
                    const [foundByProvider] = await tx
                        .select()
                        .from(schema_1.restaurantPaymentCredentials)
                        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.restaurantId, id), (0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.provider, provider)))
                        .limit(1);
                    existingRecord = foundByProvider;
                }
                let savedRecordId;
                if (existingRecord) {
                    const mergedCreds = {
                        ...existingRecord.credentials,
                        ...rawCreds,
                    };
                    const encryptedCreds = encryptCredFields(mergedCreds);
                    const updatePayload = {
                        provider,
                        title,
                        environment,
                        credentials: encryptedCreds,
                        updatedAt: new Date(),
                    };
                    if (credItem.logoUrl !== undefined)
                        updatePayload.logoUrl = credItem.logoUrl || null;
                    if (credItem.isActive !== undefined)
                        updatePayload.isActive = Boolean(credItem.isActive);
                    await tx
                        .update(schema_1.restaurantPaymentCredentials)
                        .set(updatePayload)
                        .where((0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.id, existingRecord.id));
                    savedRecordId = existingRecord.id;
                }
                else {
                    const encryptedCreds = encryptCredFields(rawCreds);
                    const newId = (0, uuid_1.v4)();
                    await tx.insert(schema_1.restaurantPaymentCredentials).values({
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
                        .update(schema_1.restaurantPaymentCredentials)
                        .set({ isActive: false, updatedAt: new Date() })
                        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.restaurantId, id), (0, drizzle_orm_1.sql) `${schema_1.restaurantPaymentCredentials.id} != ${savedRecordId}`));
                }
            }
        }
        // 👈 لو النوع بعد التحديث CUSTOM، لازم يبقى فيه بوابة دفع واحدة على الأقل مسجلة فعليًا
        if (resolvedPaymentGatewayType === "CUSTOM") {
            const [{ count }] = await tx
                .select({ count: (0, drizzle_orm_1.sql) `count(*)` })
                .from(schema_1.restaurantPaymentCredentials)
                .where((0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.restaurantId, id));
            if (Number(count) === 0) {
                throw new BadRequest_1.BadRequest("At least one paymentCredentials record is required when paymentGatewayType is CUSTOM");
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
        for (const cid of oldCuisines)
            if (!newCuisines.includes(cid))
                await decrementCuisineCount(cid);
        for (const cid of newCuisines)
            if (!oldCuisines.includes(cid))
                await incrementCuisineCount(cid);
    }
    return (0, response_1.SuccessResponse)(res, { message: "Update restaurant, owner account, and plans success" });
};
exports.updateRestaurant = updateRestaurant;
// ==========================================
// 5. DELETE RESTAURANT
// ==========================================
const deleteRestaurant = async (req, res) => {
    const { id } = req.params;
    const existingRestaurant = await connection_1.db.select().from(schema_1.restaurants).where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, id)).limit(1);
    if (!existingRestaurant[0])
        throw new NotFound_1.NotFound("Restaurant not found");
    const oldCuisines = safeParseArray(existingRestaurant[0].cuisineId);
    for (const cid of oldCuisines)
        await decrementCuisineCount(cid);
    await connection_1.db.transaction(async (tx) => {
        await tx.delete(schema_1.food).where((0, drizzle_orm_1.eq)(schema_1.food.restaurantid, id));
        await tx.delete(schema_1.restaurantBusinessPlans).where((0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.restaurantId, id)); // 👈 حذف الخطط
        await tx.delete(schema_1.restaurantWallets).where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, id));
        await tx.delete(schema_1.restrauntadmin).where((0, drizzle_orm_1.eq)(schema_1.restrauntadmin.restaurantId, id));
        await tx.delete(schema_1.restaurants).where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, id));
    });
    return (0, response_1.SuccessResponse)(res, { message: "Delete restaurant and all related data success" });
};
exports.deleteRestaurant = deleteRestaurant;
// ==========================================
// 6. GET CUISINES AND ZONES
// ==========================================
const getallcousinesandzones = async (req, res) => {
    const allCuisines = await connection_1.db.select({ id: schema_1.cuisines.id, name: schema_1.cuisines.name }).from(schema_1.cuisines).where((0, drizzle_orm_1.eq)(schema_1.cuisines.status, "active"));
    const allZones = await connection_1.db.select({ id: schema_1.zones.id, name: schema_1.zones.name }).from(schema_1.zones).where((0, drizzle_orm_1.eq)(schema_1.zones.status, "active"));
    return (0, response_1.SuccessResponse)(res, { message: "Get all cuisines and zones success", data: { allCuisines, allZones } });
};
exports.getallcousinesandzones = getallcousinesandzones;
// ==========================================
// 7. GET ALL ACTIVE SALES
// ==========================================
const getActiveSales = async (req, res) => {
    const activeSales = await connection_1.db
        .select({ id: schema_1.sales.id, name: schema_1.sales.name })
        .from(schema_1.sales)
        .where((0, drizzle_orm_1.eq)(schema_1.sales.status, "active"));
    // const allCities = await db.select({ id: cities.id, name: cities.name, nameAr: cities.nameAr, nameFr: cities.nameFr }).from(cities).where(eq(cities.status, "active"));
    return (0, response_1.SuccessResponse)(res, { message: "Get all active sales success", data: activeSales });
};
exports.getActiveSales = getActiveSales;
// ==========================================
// 8. CHANGE DELIVERY STATUS
// ==========================================
const changeDeliveryStatus = async (req, res) => {
    const { id } = req.params;
    const { deliverystatus } = req.body;
    if (deliverystatus === undefined) {
        throw new BadRequest_1.BadRequest("deliverystatus is required");
    }
    if (deliverystatus !== "delivered" && deliverystatus !== "not_delivered") {
        throw new BadRequest_1.BadRequest("deliverystatus must be either 'delivered' or 'not_delivered'");
    }
    const [existingRestaurant] = await connection_1.db.select().from(schema_1.restaurants).where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, id)).limit(1);
    if (!existingRestaurant)
        throw new NotFound_1.NotFound("Restaurant not found");
    await connection_1.db.update(schema_1.restaurants).set({ deliverystatus, updatedAt: new Date() }).where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Delivery status updated successfully" });
};
exports.changeDeliveryStatus = changeDeliveryStatus;
// ==========================================
// 9. Get Restaurant Select Data
// ==========================================
const getRestaurantSelectData = async (req, res) => {
    const restaurantSelectData = await connection_1.db.select({ id: schema_1.restaurants.id, name: schema_1.restaurants.name }).from(schema_1.restaurants).where((0, drizzle_orm_1.eq)(schema_1.restaurants.status, "active"));
    return (0, response_1.SuccessResponse)(res, { message: "Get all restaurants select data successfully", data: restaurantSelectData });
};
exports.getRestaurantSelectData = getRestaurantSelectData;
