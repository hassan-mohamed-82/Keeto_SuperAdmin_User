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
const createRestaurant = async (req, res) => {
    const clean = (v) => (typeof v === "string" ? v.trim() : v);
    const { name, nameAr, nameFr, address, addressAr, addressFr, cuisineId, zoneId, logo, cover, minDeliveryTime, maxDeliveryTime, deliveryTimeUnit, ownerFirstName, ownerLastName, ownerPhone, tags, taxNumber, taxExpireDate, taxCertificate, email, password, status } = req.body;
    if (!name || !nameAr || !nameFr || !address || !addressAr || !zoneId || !logo || !ownerFirstName || !ownerLastName || !ownerPhone || !email || !password) {
        throw new BadRequest_1.BadRequest("Missing required fields");
    }
    // 🚀 التحقق من تكرار الإيميل في جدول حسابات مديري المطاعم (المصدر الموحد للحسابات)
    const existingUser = await connection_1.db
        .select()
        .from(schema_1.restrauntadmin)
        .where((0, drizzle_orm_1.eq)(schema_1.restrauntadmin.email, clean(email)))
        .limit(1);
    if (existingUser[0]) {
        throw new BadRequest_1.BadRequest("Email already exists for a restaurant user");
    }
    // 🚀 حماية الـ Logo من الـ Objects الفارغة وحفظ الصورة
    let logoUrl = undefined;
    if (logo) {
        const result = await (0, handleImages_1.saveBase64Image)(req, logo, "restaurants");
        logoUrl = result.url;
    }
    // 🚀 حماية الـ Cover من الـ Objects الفارغة وحفظ الصورة
    let coverUrl = undefined;
    if (cover) {
        const result = await (0, handleImages_1.saveBase64Image)(req, cover, "restaurants_cover");
        coverUrl = result.url;
    }
    // تشفير الباسورد الخاص بمالك المطعم
    const hashedPassword = await bcrypt_1.default.hash(password, 10);
    const restaurantId = (0, uuid_1.v4)(); // الـ ID الموحد للمطعم
    const ownerUserId = (0, uuid_1.v4)(); // الـ ID الخاص بحساب المالك نفسه
    // تجهيز الـ Tags والـ Cuisines
    let parsedTags = [];
    if (tags) {
        parsedTags = typeof tags === "string" ? JSON.parse(tags) : tags;
    }
    let parsedCuisines = [];
    if (cuisineId) {
        parsedCuisines = typeof cuisineId === "string" ? JSON.parse(cuisineId) : cuisineId;
    }
    // 🛡️ بدء الـ Transaction لحفظ البيانات في الجداول الثلاثة معاً
    await connection_1.db.transaction(async (tx) => {
        // 1. حفظ بيانات البزنس والمطعم في جدول الـ restaurants (بدون الإيميل والباسورد)
        await tx.insert(schema_1.restaurants).values({
            id: restaurantId,
            name: clean(name),
            nameAr: clean(nameAr),
            nameFr: clean(nameFr),
            address: clean(address),
            addressAr: clean(addressAr),
            addressFr: clean(addressFr),
            cuisineId: parsedCuisines, // بيتحفظ كـ JSON array لو الداتابيز تدعمه أو نصوص بناءً على تصميمك
            zoneId: clean(zoneId),
            logo: logoUrl || '',
            cover: coverUrl || '',
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
        // 2. إنشاء حساب المالك (Owner Account) في جدول المستخدمين وتثبيت الـ Type والـ RestaurantId
        await tx.insert(schema_1.restrauntadmin).values({
            id: ownerUserId,
            restaurantId: restaurantId, // ربط المالك بالمطعم بتاعه
            branchId: null, // الـ Owner يشوف كل الفروع دائماً
            name: `${clean(ownerFirstName)} ${clean(ownerLastName)}`,
            email: clean(email),
            password: hashedPassword,
            phoneNumber: clean(ownerPhone),
            type: "owner", // الرتبة الأعلى لإدارة المطعم كاملاً
            status: "active",
        });
        // 3. إنشاء محفظة المطعم الافتراضية صفرية الرصيد
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
    // زيادة عداد المطبخ للمطابخ المختارة خارج الـ Transaction لعدم تعطيله
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
        cover: schema_1.restaurants.cover,
        status: schema_1.restaurants.status,
        cuisineIds: schema_1.restaurants.cuisineId,
        // جلب الإيميل الخاص بحساب المالك الرئيسي للمطعم
        email: schema_1.restrauntadmin.email,
        zone_id: schema_1.zones.id,
        zone_name: schema_1.zones.name,
    })
        .from(schema_1.restaurants)
        .leftJoin(schema_1.zones, (0, drizzle_orm_1.eq)(schema_1.restaurants.zoneId, schema_1.zones.id))
        // عمل Join لجلب حساب المالك فقط المرتبط بالمطعم
        .leftJoin(schema_1.restrauntadmin, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurants.id, schema_1.restrauntadmin.restaurantId), (0, drizzle_orm_1.eq)(schema_1.restrauntadmin.type, "owner")));
    const allCuisinesList = await connection_1.db.select({ id: schema_1.cuisines.id, name: schema_1.cuisines.name }).from(schema_1.cuisines);
    const cuisineMap = new Map(allCuisinesList.map(c => [c.id, c]));
    const formatted = raw.map(r => {
        let parsedCuisines = [];
        if (r.cuisineIds) {
            try {
                parsedCuisines = typeof r.cuisineIds === "string" ? JSON.parse(r.cuisineIds) : r.cuisineIds;
            }
            catch (e) {
                parsedCuisines = [];
            }
        }
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
            email: r.email || null, // إرجاع الإيميل في الـ Response
            cuisines: parsedCuisines.map((id) => cuisineMap.get(id)).filter(Boolean),
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
        // جلب الإيميل من جدول الحسابات الخاص بالمالك
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
    let parsedCuisines = [];
    if (row.restaurantObj.cuisineId) {
        try {
            parsedCuisines = typeof row.restaurantObj.cuisineId === "string"
                ? JSON.parse(row.restaurantObj.cuisineId)
                : row.restaurantObj.cuisineId;
        }
        catch (e) {
            parsedCuisines = [];
        }
    }
    let restaurantCuisines = [];
    if (parsedCuisines && parsedCuisines.length > 0) {
        restaurantCuisines = await connection_1.db
            .select({ id: schema_1.cuisines.id, name: schema_1.cuisines.name })
            .from(schema_1.cuisines)
            .where((0, drizzle_orm_1.inArray)(schema_1.cuisines.id, parsedCuisines));
    }
    const formattedRestaurant = {
        ...row.restaurantObj,
        email: row.ownerEmail || null, // دمج الإيميل مع الكائن المرجع لتطابق الـ Frontend المتوقع
        cuisines: restaurantCuisines,
        zone: row.zoneObj ? { id: row.zoneObj.id, name: row.zoneObj.name } : null,
    };
    delete formattedRestaurant.cuisineId;
    return (0, response_1.SuccessResponse)(res, {
        message: "Get restaurant by id success",
        data: formattedRestaurant
    });
};
exports.getRestaurantById = getRestaurantById;
const updateRestaurant = async (req, res) => {
    const { id } = req.params; // restaurant_id
    const { name, nameAr, nameFr, address, addressAr, addressFr, cuisineId, zoneId, lat, lng, logo, cover, minDeliveryTime, maxDeliveryTime, deliveryTimeUnit, ownerFirstName, ownerLastName, ownerPhone, tags, taxNumber, taxExpireDate, taxCertificate, email, password, confirmPassword, status } = req.body;
    // 1. التأكد من وجود المطعم
    const [existingRestaurant] = await connection_1.db
        .select()
        .from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, id))
        .limit(1);
    if (!existingRestaurant) {
        throw new NotFound_1.NotFound("Restaurant not found");
    }
    // 2. جلب حساب المالك (Owner) المرتبط بهذا المطعم لتحديث بيانات الدخول الخاصة به
    const [existingOwner] = await connection_1.db
        .select()
        .from(schema_1.restrauntadmin)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restrauntadmin.restaurantId, id), (0, drizzle_orm_1.eq)(schema_1.restrauntadmin.type, "owner")))
        .limit(1);
    // التحقق من المناطق (Zones) إذا تم إرسالها
    if (zoneId) {
        const [existingZone] = await connection_1.db.select().from(schema_1.zones).where((0, drizzle_orm_1.eq)(schema_1.zones.id, zoneId)).limit(1);
        if (!existingZone)
            throw new BadRequest_1.BadRequest("Zone not found");
    }
    // التحقق من المطابخ (Cuisines) إذا تم إرسالها
    let parsedCuisines = undefined;
    if (cuisineId !== undefined) {
        parsedCuisines = typeof cuisineId === "string" ? JSON.parse(cuisineId) : cuisineId;
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
    // التحقق من فريدية الإيميل في جدول الحسابات الموحد (restrauntadmins)
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
    // التحقق من تطابق كلمة المرور الجديدة
    if (password) {
        if (password !== confirmPassword) {
            throw new BadRequest_1.BadRequest("Password and confirm password do not match");
        }
    }
    // تحضير مصفوفات التعديل لكل جدول منفصلاً
    const restaurantUpdateData = { updatedAt: new Date() };
    const ownerUpdateData = { updatedAt: new Date() };
    // ملء بيانات جدول المطعم الرئيسي
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
        restaurantUpdateData.tags = tags;
    if (taxNumber !== undefined)
        restaurantUpdateData.taxNumber = taxNumber;
    if (taxExpireDate !== undefined)
        restaurantUpdateData.taxExpireDate = taxExpireDate;
    if (taxCertificate !== undefined)
        restaurantUpdateData.taxCertificate = taxCertificate;
    if (status)
        restaurantUpdateData.status = status;
    // ملء بيانات تحديث حساب المالك (إن وُجدت تعديلات تخصه)
    if (email)
        ownerUpdateData.email = email.trim();
    if (password)
        ownerUpdateData.password = await bcrypt_1.default.hash(password, 10);
    if (status)
        ownerUpdateData.status = status; // تجميد الحساب إذا تجمّد المطعم
    // مزامنة الاسم المجمع ورقم الهاتف للحساب إذا تغيرت حقول المالك
    if (ownerFirstName || ownerLastName) {
        const fName = ownerFirstName || existingRestaurant.ownerFirstName;
        const lName = ownerLastName || existingRestaurant.ownerLastName;
        ownerUpdateData.name = `${fName} ${lName}`;
    }
    if (ownerPhone)
        ownerUpdateData.phoneNumber = ownerPhone;
    // البدء في عملية التعديل المشتركة داخل Transaction
    await connection_1.db.transaction(async (tx) => {
        // 1. تحديث جدول المطاعم ببيانات البزنس
        if (Object.keys(restaurantUpdateData).length > 1) {
            await tx.update(schema_1.restaurants).set(restaurantUpdateData).where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, id));
        }
        // 2. تحديث جدول حسابات الموظفين لمالك المطعم (Owner)
        if (existingOwner && Object.keys(ownerUpdateData).length > 1) {
            await tx.update(schema_1.restrauntadmin)
                .set(ownerUpdateData)
                .where((0, drizzle_orm_1.eq)(schema_1.restrauntadmin.id, existingOwner.id));
        }
    });
    // التحكم في عداد المطبخ (Cuisine Count) إذا تغيرت المطابخ
    if (parsedCuisines !== undefined) {
        const oldCuisines = existingRestaurant.cuisineId || [];
        const newCuisines = parsedCuisines || [];
        // تقليل العداد للمطابخ المحذوفة
        for (const cid of oldCuisines) {
            if (!newCuisines.includes(cid)) {
                await decrementCuisineCount(cid);
            }
        }
        // زيادة العداد للمطابخ الجديدة المضافة
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
    // 1. تقليل عداد المطابخ قبل المسح
    if (existingRestaurant[0].cuisineId) {
        for (const cid of existingRestaurant[0].cuisineId) {
            await decrementCuisineCount(cid);
        }
    }
    // 2. استخدام الـ Transaction لمسح السجلات المرتبطة بشكل آمن ومترابط
    await connection_1.db.transaction(async (tx) => {
        // أ) حذف الأكلات التابعة للمطعم
        await tx.delete(schema_1.food).where((0, drizzle_orm_1.eq)(schema_1.food.restaurantid, id));
        // ب) حذف المحفظة الخاصة بالمطعم لتجنب الـ Foreign Key Constraint Error
        await tx.delete(schema_1.restaurantWallets).where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, id));
        // ج) الحذف الجديد: مسح كل حسابات الموظفين والمديرين المرتبطين بهذا المطعم
        await tx.delete(schema_1.restrauntadmin).where((0, drizzle_orm_1.eq)(schema_1.restrauntadmin.restaurantId, id));
        // د) أخيرًا حذف السجل الرئيسي للمطعم
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
