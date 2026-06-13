"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getallcousinesandzones = exports.deleteRestaurant = exports.updateRestaurant = exports.getRestaurantById = exports.getAllRestaurants = exports.createRestaurant = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const NotFound_1 = require("../../Errors/NotFound");
const BadRequest_1 = require("../../Errors/BadRequest");
const bcrypt_1 = __importDefault(require("bcrypt"));
const uuid_1 = require("uuid");
const handleImages_1 = require("../../utils/handleImages");
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
    // تحويل المدخل إلى نص سواء كان Array أو Object
    const stringified = typeof input === "string" ? input : JSON.stringify(input);
    // Regex لاستخراج الـ UUIDs النظيفة فقط وتجاهل أي أقواس أو علامات تنصيص زائدة
    const uuidRegex = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
    const matches = stringified.match(uuidRegex);
    // إرجاع الـ IDs بدون تكرار
    return matches ? Array.from(new Set(matches)) : [];
};
const createRestaurant = async (req, res) => {
    const clean = (v) => (typeof v === "string" ? v.trim() : v);
    const { name, nameAr, nameFr, address, addressAr, addressFr, zoneId, logo, cover, minDeliveryTime, maxDeliveryTime, deliveryTimeUnit, ownerFirstName, ownerLastName, ownerPhone, tags, taxNumber, taxExpireDate, taxCertificate, email, password, status, lat, lng, deliveryRadiusKm } = req.body;
    let cuisineId = req.body.cuisineId;
    if (cuisineId === undefined)
        cuisineId = req.body['cuisineId[]'];
    if (cuisineId === undefined)
        cuisineId = req.body.cuisines;
    if (cuisineId === undefined)
        cuisineId = req.body['cuisines[]'];
    if (!name || !nameAr || !nameFr || !logo || !ownerFirstName || !ownerLastName || !ownerPhone || !email || !password) {
        throw new BadRequest_1.BadRequest("Missing required fields");
    }
    // التحقق من تكرار الإيميل في جدول حسابات مديري المطاعم
    const existingUser = await connection_1.db
        .select()
        .from(schema_1.restrauntadmin)
        .where((0, drizzle_orm_1.eq)(schema_1.restrauntadmin.email, clean(email)))
        .limit(1);
    if (existingUser[0]) {
        throw new BadRequest_1.BadRequest("Email already exists for a restaurant user");
    }
    // حماية الـ Logo وحفظ الصورة
    let logoUrl = undefined;
    if (logo) {
        const result = await (0, handleImages_1.saveBase64Image)(req, logo, "restaurants");
        logoUrl = result.url;
    }
    // حماية الـ Cover وحفظ الصورة
    let coverUrl = undefined;
    if (cover) {
        const result = await (0, handleImages_1.saveBase64Image)(req, cover, "restaurants_cover");
        coverUrl = result.url;
    }
    // تشفير الباسورد الخاص بمالك المطعم
    const hashedPassword = await bcrypt_1.default.hash(password, 10);
    const restaurantId = (0, uuid_1.v4)();
    const ownerUserId = (0, uuid_1.v4)();
    // تجهيز الـ Tags والـ Cuisines
    const parsedTags = safeParseArray(tags);
    const parsedCuisines = safeParseArray(cuisineId);
    // بدء الـ Transaction لحفظ البيانات
    await connection_1.db.transaction(async (tx) => {
        // 1. حفظ بيانات المطعم
        await tx.insert(schema_1.restaurants).values({
            id: restaurantId,
            name: clean(name),
            nameAr: clean(nameAr),
            nameFr: clean(nameFr),
            address: clean(address),
            addressAr: clean(addressAr),
            addressFr: clean(addressFr),
            cuisineId: parsedCuisines,
            zoneId: clean(zoneId),
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
        });
        // 2. إنشاء حساب المالك
        await tx.insert(schema_1.restrauntadmin).values({
            id: ownerUserId,
            restaurantId: restaurantId,
            branchId: null,
            name: `${clean(ownerFirstName)} ${clean(ownerLastName)}`,
            email: clean(email),
            password: hashedPassword,
            phoneNumber: clean(ownerPhone),
            type: "owner",
            status: "active",
        });
        // 3. إنشاء محفظة المطعم
        await tx.insert(schema_1.restaurantWallets).values({
            id: (0, uuid_1.v4)(),
            restaurantId: restaurantId,
            balance: "0.00",
            collectedCash: "0.00",
            pendingWithdraw: "0.00",
            totalWithdrawn: "0.00",
            totalEarning: "0.00",
        });
    });
    // زيادة عداد المطبخ للمطابخ المختارة
    for (const cid of parsedCuisines) {
        await incrementCuisineCount(cid);
    }
    return (0, response_1.SuccessResponse)(res, {
        message: "Restaurant and Owner account created successfully",
        data: {
            restaurantId,
            ownerUserId
        }
    }, 201);
};
exports.createRestaurant = createRestaurant;
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
        cuisineIds: schema_1.restaurants.cuisineId,
        email: schema_1.restrauntadmin.email,
        zone_id: schema_1.zones.id,
        zone_name: schema_1.zones.name,
    })
        .from(schema_1.restaurants)
        .leftJoin(schema_1.zones, (0, drizzle_orm_1.eq)(schema_1.restaurants.zoneId, schema_1.zones.id))
        .leftJoin(schema_1.restrauntadmin, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurants.id, schema_1.restrauntadmin.restaurantId), (0, drizzle_orm_1.eq)(schema_1.restrauntadmin.type, "owner")));
    // تحديد الـ 4 حقول فقط للـ cuisines
    const allCuisinesList = await connection_1.db.select({
        id: schema_1.cuisines.id,
        name: schema_1.cuisines.name,
        nameAr: schema_1.cuisines.nameAr,
        nameFr: schema_1.cuisines.nameFr
    }).from(schema_1.cuisines);
    const cuisineMap = new Map(allCuisinesList.map(c => [String(c.id).toLowerCase(), c]));
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
            email: r.email || null,
            deliveryRadiusKm: r.deliveryRadiusKm,
            lat: r.lat,
            lng: r.lng,
            cuisines: parsedCuisines.map((id) => cuisineMap.get(id.toLowerCase())).filter(Boolean),
            zone: r.zone_id
                ? { id: r.zone_id, name: r.zone_name }
                : null,
        };
    });
    return (0, response_1.SuccessResponse)(res, {
        message: "Get all restaurants success",
        data: formatted
    });
};
exports.getAllRestaurants = getAllRestaurants;
const getRestaurantById = async (req, res) => {
    const { id } = req.params;
    const rawRestaurants = await connection_1.db
        .select({
        restaurantObj: schema_1.restaurants,
        zoneObj: schema_1.zones,
        ownerEmail: schema_1.restrauntadmin.email,
    })
        .from(schema_1.restaurants)
        .leftJoin(schema_1.zones, (0, drizzle_orm_1.eq)(schema_1.restaurants.zoneId, schema_1.zones.id))
        .leftJoin(schema_1.restrauntadmin, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurants.id, schema_1.restrauntadmin.restaurantId), (0, drizzle_orm_1.eq)(schema_1.restrauntadmin.type, "owner")))
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, id))
        .limit(1);
    if (!rawRestaurants[0]) {
        throw new NotFound_1.NotFound("Restaurant not found");
    }
    const row = rawRestaurants[0];
    let parsedCuisines = safeParseArray(row.restaurantObj.cuisineId);
    let restaurantCuisines = [];
    if (parsedCuisines && parsedCuisines.length > 0) {
        // تحديد الـ 4 حقول فقط للـ cuisines
        restaurantCuisines = await connection_1.db
            .select({
            id: schema_1.cuisines.id,
            name: schema_1.cuisines.name,
            nameAr: schema_1.cuisines.nameAr,
            nameFr: schema_1.cuisines.nameFr
        })
            .from(schema_1.cuisines)
            .where((0, drizzle_orm_1.inArray)(schema_1.cuisines.id, parsedCuisines));
    }
    const formattedRestaurant = {
        ...row.restaurantObj,
        email: row.ownerEmail || null,
        cuisines: restaurantCuisines,
        zone: row.zoneObj ? { id: row.zoneObj.id, name: row.zoneObj.name } : null,
    };
    // إزالة حقل الـ IDs الخام حتى لا يظهر في الـ JSON النهائي
    delete formattedRestaurant.cuisineId;
    return (0, response_1.SuccessResponse)(res, {
        message: "Get restaurant by id success",
        data: formattedRestaurant
    });
};
exports.getRestaurantById = getRestaurantById;
const updateRestaurant = async (req, res) => {
    const { id } = req.params;
    const { name, nameAr, nameFr, address, addressAr, addressFr, zoneId, lat, lng, logo, cover, minDeliveryTime, maxDeliveryTime, deliveryTimeUnit, ownerFirstName, ownerLastName, ownerPhone, tags, taxNumber, taxExpireDate, taxCertificate, email, password, confirmPassword, status, deliveryRadiusKm } = req.body;
    let cuisineId = req.body.cuisineId;
    if (cuisineId === undefined)
        cuisineId = req.body['cuisineId[]'];
    if (cuisineId === undefined)
        cuisineId = req.body.cuisines;
    if (cuisineId === undefined)
        cuisineId = req.body['cuisines[]'];
    const [existingRestaurant] = await connection_1.db
        .select()
        .from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, id))
        .limit(1);
    if (!existingRestaurant) {
        throw new NotFound_1.NotFound("Restaurant not found");
    }
    const [existingOwner] = await connection_1.db
        .select()
        .from(schema_1.restrauntadmin)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restrauntadmin.restaurantId, id), (0, drizzle_orm_1.eq)(schema_1.restrauntadmin.type, "owner")))
        .limit(1);
    if (zoneId) {
        const [existingZone] = await connection_1.db.select().from(schema_1.zones).where((0, drizzle_orm_1.eq)(schema_1.zones.id, zoneId)).limit(1);
        if (!existingZone)
            throw new BadRequest_1.BadRequest("Zone not found");
    }
    let parsedCuisines = undefined;
    if (cuisineId !== undefined) {
        parsedCuisines = safeParseArray(cuisineId);
        if (parsedCuisines && parsedCuisines.length > 0) {
            const existingCuisines = await connection_1.db
                .select()
                .from(schema_1.cuisines)
                .where((0, drizzle_orm_1.inArray)(schema_1.cuisines.id, parsedCuisines));
            if (existingCuisines.length !== parsedCuisines.length) {
                throw new BadRequest_1.BadRequest("One or more Cuisines not found");
            }
        }
    }
    if (email && existingOwner && email !== existingOwner.email) {
        const [emailExists] = await connection_1.db
            .select()
            .from(schema_1.restrauntadmin)
            .where((0, drizzle_orm_1.eq)(schema_1.restrauntadmin.email, email.trim()))
            .limit(1);
        if (emailExists) {
            throw new BadRequest_1.BadRequest("Email already exists for another user");
        }
    }
    if (password) {
        if (password !== confirmPassword) {
            throw new BadRequest_1.BadRequest("Password and confirm password do not match");
        }
    }
    const restaurantUpdateData = { updatedAt: new Date() };
    const ownerUpdateData = { updatedAt: new Date() };
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
    if (zoneId)
        restaurantUpdateData.zoneId = zoneId;
    if (lat !== undefined)
        restaurantUpdateData.lat = lat;
    if (lng !== undefined)
        restaurantUpdateData.lng = lng;
    if (deliveryRadiusKm !== undefined)
        restaurantUpdateData.deliveryRadiusKm = deliveryRadiusKm;
    if (logo) {
        restaurantUpdateData.logo = await (0, handleImages_1.handleImageUpdate)(req, existingRestaurant.logo, logo, "restaurants");
    }
    if (cover !== undefined) {
        if (cover === "" || cover === null) {
            restaurantUpdateData.cover = "";
        }
        else {
            restaurantUpdateData.cover = await (0, handleImages_1.handleImageUpdate)(req, existingRestaurant.cover, cover, "restaurants_cover");
        }
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
    if (email)
        ownerUpdateData.email = email.trim();
    if (password)
        ownerUpdateData.password = await bcrypt_1.default.hash(password, 10);
    if (status)
        ownerUpdateData.status = status;
    if (ownerFirstName || ownerLastName) {
        const fName = ownerFirstName || existingRestaurant.ownerFirstName;
        const lName = ownerLastName || existingRestaurant.ownerLastName;
        ownerUpdateData.name = `${fName} ${lName}`;
    }
    if (ownerPhone)
        ownerUpdateData.phoneNumber = ownerPhone;
    await connection_1.db.transaction(async (tx) => {
        if (Object.keys(restaurantUpdateData).length > 1) {
            await tx.update(schema_1.restaurants).set(restaurantUpdateData).where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, id));
        }
        if (existingOwner && Object.keys(ownerUpdateData).length > 1) {
            await tx.update(schema_1.restrauntadmin)
                .set(ownerUpdateData)
                .where((0, drizzle_orm_1.eq)(schema_1.restrauntadmin.id, existingOwner.id));
        }
    });
    if (parsedCuisines !== undefined) {
        const oldCuisines = safeParseArray(existingRestaurant.cuisineId);
        const newCuisines = parsedCuisines || [];
        for (const cid of oldCuisines) {
            if (!newCuisines.includes(cid)) {
                await decrementCuisineCount(cid);
            }
        }
        for (const cid of newCuisines) {
            if (!oldCuisines.includes(cid)) {
                await incrementCuisineCount(cid);
            }
        }
    }
    return (0, response_1.SuccessResponse)(res, { message: "Update restaurant and owner account success" });
};
exports.updateRestaurant = updateRestaurant;
const deleteRestaurant = async (req, res) => {
    const { id } = req.params;
    const existingRestaurant = await connection_1.db
        .select()
        .from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, id))
        .limit(1);
    if (!existingRestaurant[0]) {
        throw new NotFound_1.NotFound("Restaurant not found");
    }
    const oldCuisines = safeParseArray(existingRestaurant[0].cuisineId);
    for (const cid of oldCuisines) {
        await decrementCuisineCount(cid);
    }
    await connection_1.db.transaction(async (tx) => {
        await tx.delete(schema_1.food).where((0, drizzle_orm_1.eq)(schema_1.food.restaurantid, id));
        await tx.delete(schema_1.restaurantWallets).where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, id));
        await tx.delete(schema_1.restrauntadmin).where((0, drizzle_orm_1.eq)(schema_1.restrauntadmin.restaurantId, id));
        await tx.delete(schema_1.restaurants).where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, id));
    });
    return (0, response_1.SuccessResponse)(res, { message: "Delete restaurant and all related users/wallets success" });
};
exports.deleteRestaurant = deleteRestaurant;
const getallcousinesandzones = async (req, res) => {
    const allCuisines = await connection_1.db.select({
        id: schema_1.cuisines.id,
        name: schema_1.cuisines.name,
    }).from(schema_1.cuisines)
        .where((0, drizzle_orm_1.eq)(schema_1.cuisines.status, "active"));
    const allZones = await connection_1.db.select({
        id: schema_1.zones.id,
        name: schema_1.zones.name,
    }).from(schema_1.zones)
        .where((0, drizzle_orm_1.eq)(schema_1.zones.status, "active"));
    return (0, response_1.SuccessResponse)(res, { message: "Get all cuisines and zones success", data: { allCuisines, allZones } });
};
exports.getallcousinesandzones = getallcousinesandzones;
