"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyOrderTracking = exports.notifyAdmins = exports.notifyRestaurant = exports.notifyShippingCompany = exports.notifyDeliveryMan = exports.getIO = exports.initSocket = exports.invalidateCourierCache = void 0;
const socket_io_1 = require("socket.io");
const auth_1 = require("../../utils/auth");
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const dispatchEngine_1 = require("../shipping/dispatchEngine");
const socketEvents_1 = require("./socketEvents");
let io = null;
// Track last DB write time per courier to save coordinates to MySQL every 30s
const lastDbWriteTimeMap = new Map();
// Grace period timers upon disconnect (30s grace)
const disconnectGraceTimers = new Map();
const courierMetaCache = new Map();
const courierOrdersCache = new Map();
const invalidateCourierCache = (deliveryManId) => {
    courierOrdersCache.delete(deliveryManId);
    courierMetaCache.delete(deliveryManId);
};
exports.invalidateCourierCache = invalidateCourierCache;
const getCourierMeta = async (deliveryManId) => {
    const cached = courierMetaCache.get(deliveryManId);
    const now = Date.now();
    if (cached && now - cached.cachedAt < 5 * 60 * 1000) {
        return cached;
    }
    const [dm] = await connection_1.db
        .select({
        shippingCompanyId: schema_1.deliveryMen.shippingCompanyId,
        name: schema_1.deliveryMen.name,
        phone: schema_1.deliveryMen.phone,
    })
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, deliveryManId))
        .limit(1);
    const meta = {
        shippingCompanyId: dm?.shippingCompanyId || null,
        name: dm?.name || null,
        phone: dm?.phone || null,
        cachedAt: now,
    };
    courierMetaCache.set(deliveryManId, meta);
    return meta;
};
const getCourierActiveOrders = async (deliveryManId) => {
    const cached = courierOrdersCache.get(deliveryManId);
    const now = Date.now();
    if (cached && now - cached.cachedAt < 15 * 1000) {
        return cached.orders;
    }
    const activeOrders = await connection_1.db
        .select({
        id: schema_1.orders.id,
        orderNumber: schema_1.orders.orderNumber,
        shippingStatus: schema_1.orders.shippingStatus,
    })
        .from(schema_1.orders)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.deliveryManId, deliveryManId), (0, drizzle_orm_1.inArray)(schema_1.orders.shippingStatus, ["assigned", "picked_up"])));
    courierOrdersCache.set(deliveryManId, { orders: activeOrders, cachedAt: now });
    return activeOrders;
};
const initSocket = (httpServer) => {
    io = new socket_io_1.Server(httpServer, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
        },
    });
    // -------------------------------------------------------------
    // Phase 7.1: Mandatory Authentication Middleware
    // -------------------------------------------------------------
    const authMiddleware = (socket, next) => {
        try {
            let rawToken = socket.handshake.auth?.token ||
                socket.handshake.headers?.authorization ||
                socket.handshake.query?.token;
            if (!rawToken) {
                return next(new Error("Authentication error: No token provided"));
            }
            const token = typeof rawToken === "string" && rawToken.startsWith("Bearer ")
                ? rawToken.slice(7).trim()
                : String(rawToken).trim();
            const decoded = (0, auth_1.verifyToken)(token);
            if (!decoded || !decoded.id || !decoded.role) {
                return next(new Error("Authentication error: Invalid token"));
            }
            socket.data.user = decoded;
            next();
        }
        catch (error) {
            return next(new Error(`Authentication error: ${error.message}`));
        }
    };
    io.use(authMiddleware);
    // =========================================================================
    // Courier Connection Handler (Used by both main IO and /courier namespace)
    // =========================================================================
    const handleCourierConnection = (socket) => {
        const user = socket.data.user;
        // Phase 7: Only couriers are handled here
        if (user?.role !== "delivery_man") {
            socket.disconnect(true);
            return;
        }
        const deliveryManId = user.deliveryManId || user.id;
        // Cancel grace timer if reconnected
        if (deliveryManId && disconnectGraceTimers.has(deliveryManId)) {
            clearTimeout(disconnectGraceTimers.get(deliveryManId));
            disconnectGraceTimers.delete(deliveryManId);
        }
        // Join courier personal room
        socket.join(`courier:${deliveryManId}`);
        // Event: courier:online
        socket.on(socketEvents_1.SOCKET_EVENTS.COURIER_ONLINE, async () => {
            try {
                if (disconnectGraceTimers.has(deliveryManId)) {
                    clearTimeout(disconnectGraceTimers.get(deliveryManId));
                    disconnectGraceTimers.delete(deliveryManId);
                }
                await connection_1.db
                    .update(schema_1.deliveryMen)
                    .set({ isOnline: true })
                    .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, deliveryManId));
                const meta = await getCourierMeta(deliveryManId);
                if (meta.shippingCompanyId) {
                    (0, exports.notifyShippingCompany)(meta.shippingCompanyId, "courier:status_changed", {
                        deliveryManId,
                        isOnline: true,
                    });
                }
            }
            catch (err) {
                console.error("Error setting courier online:", err);
            }
        });
        // Event: courier:location (Optimized with In-Memory Caching)
        socket.on(socketEvents_1.SOCKET_EVENTS.COURIER_LOCATION, async (payload) => {
            try {
                const { lat, lng } = payload;
                if (lat === undefined || lng === undefined)
                    return;
                // 1. Update Redis GEO & alive key (TTL 60s)
                await (0, dispatchEngine_1.updateCourierRedisLocation)(deliveryManId, lat, lng);
                // 2. Fetch cached profile and active orders (0-1 DB queries instead of 2 on every ping)
                const [meta, activeOrders] = await Promise.all([
                    getCourierMeta(deliveryManId),
                    getCourierActiveOrders(deliveryManId),
                ]);
                // Broadcast to company dashboard live map (includes courier details & active orders)
                if (meta.shippingCompanyId) {
                    (0, exports.notifyShippingCompany)(meta.shippingCompanyId, socketEvents_1.SOCKET_EVENTS.DELIVERY_LOCATION_CHANGED, {
                        deliveryManId,
                        deliveryManName: meta.name || null,
                        deliveryManPhone: meta.phone || null,
                        lat,
                        lng,
                        activeOrders: activeOrders.map((o) => ({
                            orderId: o.id,
                            orderNumber: o.orderNumber,
                            shippingStatus: o.shippingStatus,
                        })),
                        updatedAt: new Date(),
                    });
                }
                // 3. Broadcast to active assigned orders tracking rooms
                for (const ord of activeOrders) {
                    (0, exports.notifyOrderTracking)(ord.id, socketEvents_1.SOCKET_EVENTS.ORDER_COURIER_LOCATION, {
                        orderId: ord.id,
                        deliveryManId,
                        deliveryManName: meta.name || null,
                        deliveryManPhone: meta.phone || null,
                        lat,
                        lng,
                    });
                }
                // 4. Save to MySQL every 30s as backup
                const lastWrite = lastDbWriteTimeMap.get(deliveryManId) || 0;
                const now = Date.now();
                if (now - lastWrite >= 30000) {
                    lastDbWriteTimeMap.set(deliveryManId, now);
                    await connection_1.db
                        .update(schema_1.deliveryMen)
                        .set({
                        currentLat: String(lat),
                        currentLng: String(lng),
                        lastLocationUpdate: new Date(),
                    })
                        .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, deliveryManId));
                }
            }
            catch (err) {
                console.error("Error updating courier location:", err);
            }
        });
        // Event: order:reject
        socket.on(socketEvents_1.SOCKET_EVENTS.COURIER_REJECT, async (payload) => {
            try {
                const { orderId, reason } = payload;
                if (!orderId || !reason) {
                    socket.emit("error", { message: "orderId and reason are required" });
                    return;
                }
                const result = await (0, dispatchEngine_1.rejectOrderByCourier)(orderId, deliveryManId, reason);
                (0, exports.invalidateCourierCache)(deliveryManId);
                socket.emit("order:reject_ack", { success: true, orderId, result });
            }
            catch (err) {
                socket.emit("error", { message: err.message });
            }
        });
        // Event: courier:offline / disconnect with 30s grace period & multi-device check
        const handleOffline = () => {
            // Cancel existing timer if any (prevents double callbacks / race condition)
            if (disconnectGraceTimers.has(deliveryManId)) {
                clearTimeout(disconnectGraceTimers.get(deliveryManId));
                disconnectGraceTimers.delete(deliveryManId);
            }
            const timer = setTimeout(async () => {
                try {
                    // Check if courier still has other active sockets (multi-device support)
                    if (io) {
                        const activeSockets = await io.in(`courier:${deliveryManId}`).fetchSockets();
                        if (activeSockets.length > 0) {
                            disconnectGraceTimers.delete(deliveryManId);
                            return;
                        }
                    }
                    await (0, dispatchEngine_1.removeCourierFromRedis)(deliveryManId);
                    await connection_1.db
                        .update(schema_1.deliveryMen)
                        .set({ isOnline: false })
                        .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, deliveryManId));
                    const meta = await getCourierMeta(deliveryManId);
                    if (meta.shippingCompanyId) {
                        (0, exports.notifyShippingCompany)(meta.shippingCompanyId, "courier:status_changed", {
                            deliveryManId,
                            isOnline: false,
                        });
                    }
                    (0, exports.invalidateCourierCache)(deliveryManId);
                    disconnectGraceTimers.delete(deliveryManId);
                }
                catch (err) {
                    console.error("Error setting courier offline after grace period:", err);
                }
            }, 30000);
            disconnectGraceTimers.set(deliveryManId, timer);
        };
        socket.on(socketEvents_1.SOCKET_EVENTS.COURIER_OFFLINE, handleOffline);
        socket.on("disconnect", handleOffline);
    };
    // =========================================================================
    // /courier Dedicated Namespace
    // =========================================================================
    const courierNamespace = io.of("/courier");
    courierNamespace.use(authMiddleware);
    courierNamespace.on("connection", handleCourierConnection);
    // =========================================================================
    // Default '/' Namespace Handler
    // =========================================================================
    io.on("connection", async (socket) => {
        const user = socket.data.user;
        if (!user) {
            socket.disconnect(true);
            return;
        }
        // If courier connects to default namespace
        if (user.role === "delivery_man") {
            handleCourierConnection(socket);
            return;
        }
        // Super-admin room
        if (user.role === "admin" && user.type === "super_admin") {
            socket.join("superadmin:room");
        }
        // Restaurant room
        if (user.restaurantId) {
            socket.join(`restaurant:${user.restaurantId}`);
        }
        // Shipping company room: ONLY shipping_company users join (Phase 7.2)
        if (user.role === "shipping_company" && user.shippingCompanyId) {
            socket.join(`shipping_company:${user.shippingCompanyId}`);
        }
        // Phase 7.3: order:track authorized joining
        socket.on(socketEvents_1.SOCKET_EVENTS.ORDER_TRACK, async (data) => {
            try {
                const { orderId } = data;
                if (!orderId)
                    return;
                // Verify access to track order
                const [ord] = await connection_1.db
                    .select({
                    id: schema_1.orders.id,
                    userId: schema_1.orders.userId,
                    restaurantId: schema_1.orders.restaurantId,
                    shippingCompanyId: schema_1.orders.shippingCompanyId,
                    deliveryManId: schema_1.orders.deliveryManId,
                })
                    .from(schema_1.orders)
                    .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId))
                    .limit(1);
                if (!ord)
                    return;
                const isCustomer = user.role === "user" && ord.userId === user.id;
                const isSuperAdmin = user.role === "admin" && user.type === "super_admin";
                const isRest = (user.role === "restaurant_admin" || user.restaurantId) && ord.restaurantId === user.restaurantId;
                const isCompany = user.role === "shipping_company" && ord.shippingCompanyId === user.shippingCompanyId;
                const isCourier = user.role === "delivery_man" && ord.deliveryManId === (user.deliveryManId || user.id);
                if (isCustomer || isSuperAdmin || isRest || isCompany || isCourier) {
                    socket.join(`order:track:${orderId}`);
                    socket.emit("order:track:joined", { orderId, success: true });
                }
                else {
                    socket.emit("error", { message: "Unauthorized to track this order" });
                }
            }
            catch (err) {
                console.error("Error joining order track room:", err);
            }
        });
    });
    return io;
};
exports.initSocket = initSocket;
const getIO = () => {
    if (!io) {
        throw new Error("Socket.io has not been initialized. Call initSocket first.");
    }
    return io;
};
exports.getIO = getIO;
// =========================================================================
// Helpers for broadcasting
// =========================================================================
const notifyDeliveryMan = (deliveryManId, event, data) => {
    if (io) {
        io.to(`courier:${deliveryManId}`).emit(event, data);
        io.of("/courier").to(`courier:${deliveryManId}`).emit(event, data);
    }
};
exports.notifyDeliveryMan = notifyDeliveryMan;
const notifyShippingCompany = (companyId, event, data) => {
    if (io) {
        io.to(`shipping_company:${companyId}`).emit(event, data);
    }
};
exports.notifyShippingCompany = notifyShippingCompany;
const notifyRestaurant = (restaurantId, event, data) => {
    if (io) {
        io.to(`restaurant:${restaurantId}`).emit(event, data);
    }
};
exports.notifyRestaurant = notifyRestaurant;
const notifyAdmins = (event, data) => {
    if (io) {
        io.to("superadmin:room").emit(event, data);
    }
};
exports.notifyAdmins = notifyAdmins;
const notifyOrderTracking = (orderId, event, data) => {
    if (io) {
        io.to(`order:track:${orderId}`).emit(event, data);
    }
};
exports.notifyOrderTracking = notifyOrderTracking;
