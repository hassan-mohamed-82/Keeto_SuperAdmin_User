"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyOrderTracking = exports.notifyShippingCompany = exports.notifyDeliveryMan = exports.getIO = exports.initSocket = void 0;
const socket_io_1 = require("socket.io");
const auth_1 = require("../../utils/auth");
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const dispatchEngine_1 = require("../shipping/dispatchEngine");
let io = null;
// تتبع آخر وقت تم الحفظ فيه في MySQL لكل مندوب (لتخفيف الضغط والحفظ كل 30 ثانية فقط)
const lastDbWriteTimeMap = new Map();
// مؤقتات فترة السماح (Grace Period) عند انقطاع الاتصال (30 ثانية)
const disconnectGraceTimers = new Map();
const initSocket = (httpServer) => {
    io = new socket_io_1.Server(httpServer, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });
    // الـ Middleware العام للمصادقة عبر التوكن
    const authMiddleware = (socket, next) => {
        try {
            const token = socket.handshake.auth?.token ||
                socket.handshake.headers?.authorization?.replace("Bearer ", "") ||
                socket.handshake.query?.token;
            if (!token) {
                return next();
            }
            const decoded = (0, auth_1.verifyToken)(token);
            socket.data.user = decoded;
            next();
        }
        catch (error) {
            console.error("Socket authentication error:", error);
            next();
        }
    };
    io.use(authMiddleware);
    // =========================================================================
    // Handler للاتصال العام و /courier Namespace
    // =========================================================================
    const handleCourierConnection = (socket) => {
        const user = socket.data.user;
        const deliveryManId = user?.deliveryManId || user?.id;
        // إلغاء مؤقت قطع الاتصال إن وجد (في حالة إعادة الاتصال السريع)
        if (deliveryManId && disconnectGraceTimers.has(deliveryManId)) {
            clearTimeout(disconnectGraceTimers.get(deliveryManId));
            disconnectGraceTimers.delete(deliveryManId);
        }
        // 1. حدث تسجيل المندوب أونلاين (courier:online)
        socket.on("courier:online", async () => {
            if (!deliveryManId)
                return;
            socket.join(`delivery_man:${deliveryManId}`);
            socket.join(`courier:${deliveryManId}`);
            try {
                await connection_1.db
                    .update(schema_1.deliveryMen)
                    .set({ isOnline: true })
                    .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, deliveryManId));
                if (user?.shippingCompanyId) {
                    io?.to(`shipping_company:${user.shippingCompanyId}`).emit("courier:online", {
                        courierId: deliveryManId,
                        isOnline: true,
                    });
                }
            }
            catch (err) {
                console.error("Error setting courier online:", err);
            }
        });
        // 2. حدث إرسال الموقع الجغرافي كل 5 ثوانٍ (courier:location)
        socket.on("courier:location", async (data) => {
            if (!deliveryManId)
                return;
            const latNum = typeof data.lat === "string" ? parseFloat(data.lat) : data.lat;
            const lngNum = typeof data.lng === "string" ? parseFloat(data.lng) : data.lng;
            if (isNaN(latNum) || isNaN(lngNum))
                return;
            const companyId = user?.shippingCompanyId;
            // A) حفظ اللوكيشن في Redis GEO + ضبط مفتاح Alive بـ TTL 60 ثانية
            await (0, dispatchEngine_1.updateCourierRedisLocation)(deliveryManId, latNum, lngNum, companyId);
            // B) بث مباشر لداشبورد شركة الشحن (Live Map)
            if (companyId) {
                io?.to(`shipping_company:${companyId}`).emit("courier:location_update", {
                    courierId: deliveryManId,
                    lat: latNum,
                    lng: lngNum,
                    speed: data.speed,
                    heading: data.heading,
                    timestamp: Date.now(),
                });
            }
            // بث لغرف تتبع الأوردرات الجاري توصيلها
            const activeOrders = await connection_1.db
                .select({ id: schema_1.orders.id })
                .from(schema_1.orders)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.deliveryManId, deliveryManId), (0, drizzle_orm_1.inArray)(schema_1.orders.status, ["accepted", "preparing", "out_for_delivery"])));
            for (const ord of activeOrders) {
                io?.to(`order:${ord.id}`).emit("order:delivery_location", {
                    orderId: ord.id,
                    courierId: deliveryManId,
                    lat: latNum,
                    lng: lngNum,
                });
            }
            // C) حفظ في MySQL كل 30 ثانية فقط (Throttled DB Backup)
            const now = Date.now();
            const lastWrite = lastDbWriteTimeMap.get(deliveryManId) || 0;
            if (now - lastWrite >= 30000) {
                lastDbWriteTimeMap.set(deliveryManId, now);
                try {
                    await connection_1.db
                        .update(schema_1.deliveryMen)
                        .set({
                        currentLat: String(latNum),
                        currentLng: String(lngNum),
                        lastLocationUpdate: new Date(),
                    })
                        .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, deliveryManId));
                }
                catch (dbErr) {
                    console.error("Error backing up courier location to MySQL:", dbErr);
                }
            }
        });
        // 3. حدث رفض المندوب للطلب مع السبب الإجباري وإعادة التوزيع
        socket.on("courier:reject_order", async (data, ack) => {
            try {
                if (!deliveryManId)
                    throw new Error("Courier not identified");
                if (!data.rejectReason || data.rejectReason.trim() === "") {
                    throw new Error("Reject reason is mandatory");
                }
                const retryResult = await (0, dispatchEngine_1.rejectOrderByCourier)(data.orderId, deliveryManId, data.rejectReason);
                if (ack) {
                    ack({ success: true, message: "Order rejected and re-dispatched", result: retryResult });
                }
            }
            catch (err) {
                if (ack) {
                    ack({ success: false, message: err.message });
                }
            }
        });
        // 4. حدث تسجيل المندوب أوفلاين أو انقطاع الاتصال مع فترة سماح 30 ثانية
        const handleOffline = () => {
            if (!deliveryManId)
                return;
            // ضبط مؤقت سماح لمدة 30 ثانية قبل الحذف النهائي من Redis GEO وتحديث الـ DB
            const timer = setTimeout(async () => {
                disconnectGraceTimers.delete(deliveryManId);
                await (0, dispatchEngine_1.removeCourierFromRedis)(deliveryManId);
                try {
                    await connection_1.db
                        .update(schema_1.deliveryMen)
                        .set({ isOnline: false })
                        .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, deliveryManId));
                    if (user?.shippingCompanyId) {
                        io?.to(`shipping_company:${user.shippingCompanyId}`).emit("courier:online", {
                            courierId: deliveryManId,
                            isOnline: false,
                        });
                    }
                }
                catch (err) {
                    console.error("Error setting courier offline after grace period:", err);
                }
            }, 30000);
            disconnectGraceTimers.set(deliveryManId, timer);
        };
        socket.on("courier:offline", handleOffline);
        socket.on("disconnect", handleOffline);
    };
    // تطبيق الـ Handler على الـ default connection
    io.on("connection", async (socket) => {
        const user = socket.data.user;
        // إذا كان المندوب متصلاً بالسوكيت الرئيسي
        if (user && (user.role === "delivery_man" || user.type === "delivery_man")) {
            handleCourierConnection(socket);
        }
        // إذا كان المتصل شركة شحن أو أدمن الشركة
        if (user && (user.role === "shipping_company" || user.shippingCompanyId)) {
            const companyId = user.shippingCompanyId || user.id;
            socket.join(`shipping_company:${companyId}`);
        }
        // متابعة أوردر معين
        socket.on("order:track", (data) => {
            if (data?.orderId) {
                socket.join(`order:${data.orderId}`);
            }
        });
        socket.on("order:untrack", (data) => {
            if (data?.orderId) {
                socket.leave(`order:${data.orderId}`);
            }
        });
    });
    // دعم الـ Namespace المخصص /courier
    const courierNamespace = io.of("/courier");
    courierNamespace.use(authMiddleware);
    courierNamespace.on("connection", (socket) => {
        handleCourierConnection(socket);
    });
    return io;
};
exports.initSocket = initSocket;
const getIO = () => {
    if (!io) {
        throw new Error("Socket.IO has not been initialized!");
    }
    return io;
};
exports.getIO = getIO;
const notifyDeliveryMan = (deliveryManId, event, data) => {
    if (io) {
        io.to(`delivery_man:${deliveryManId}`).emit(event, data);
        io.of("/courier").to(`delivery_man:${deliveryManId}`).emit(event, data);
    }
};
exports.notifyDeliveryMan = notifyDeliveryMan;
const notifyShippingCompany = (companyId, event, data) => {
    if (io) {
        io.to(`shipping_company:${companyId}`).emit(event, data);
    }
};
exports.notifyShippingCompany = notifyShippingCompany;
const notifyOrderTracking = (orderId, event, data) => {
    if (io) {
        io.to(`order:${orderId}`).emit(event, data);
    }
};
exports.notifyOrderTracking = notifyOrderTracking;
