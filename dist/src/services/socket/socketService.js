"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyOrderTracking = exports.notifyAdmins = exports.notifyRestaurant = exports.notifyShippingCompany = exports.notifyDeliveryMan = exports.getIO = exports.initSocket = void 0;
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
            const token = socket.handshake.auth?.token ||
                socket.handshake.headers?.authorization?.replace("Bearer ", "") ||
                socket.handshake.query?.token;
            if (!token) {
                return next(new Error("Authentication error: No token provided"));
            }
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
                await connection_1.db
                    .update(schema_1.deliveryMen)
                    .set({ isOnline: true })
                    .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, deliveryManId));
                const [dm] = await connection_1.db
                    .select({ shippingCompanyId: schema_1.deliveryMen.shippingCompanyId })
                    .from(schema_1.deliveryMen)
                    .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, deliveryManId))
                    .limit(1);
                if (dm?.shippingCompanyId) {
                    (0, exports.notifyShippingCompany)(dm.shippingCompanyId, "courier:status_changed", {
                        deliveryManId,
                        isOnline: true,
                    });
                }
            }
            catch (err) {
                console.error("Error setting courier online:", err);
            }
        });
        // Event: courier:location
        socket.on(socketEvents_1.SOCKET_EVENTS.COURIER_LOCATION, async (payload) => {
            try {
                const { lat, lng } = payload;
                if (lat === undefined || lng === undefined)
                    return;
                // 1. Update Redis GEO & alive key (TTL 60s)
                await (0, dispatchEngine_1.updateCourierRedisLocation)(deliveryManId, lat, lng);
                const [dm] = await connection_1.db
                    .select({
                    shippingCompanyId: schema_1.deliveryMen.shippingCompanyId,
                    activeOrdersCount: schema_1.deliveryMen.activeOrdersCount,
                })
                    .from(schema_1.deliveryMen)
                    .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, deliveryManId))
                    .limit(1);
                // 2. Broadcast to company dashboard live map
                if (dm?.shippingCompanyId) {
                    (0, exports.notifyShippingCompany)(dm.shippingCompanyId, socketEvents_1.SOCKET_EVENTS.DELIVERY_LOCATION_CHANGED, {
                        deliveryManId,
                        lat,
                        lng,
                        updatedAt: new Date(),
                    });
                }
                // 3. Broadcast to active assigned orders tracking rooms
                if (dm && dm.activeOrdersCount > 0) {
                    const activeOrders = await connection_1.db
                        .select({ id: schema_1.orders.id })
                        .from(schema_1.orders)
                        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.deliveryManId, deliveryManId), (0, drizzle_orm_1.eq)(schema_1.orders.shippingStatus, "assigned")));
                    for (const ord of activeOrders) {
                        (0, exports.notifyOrderTracking)(ord.id, socketEvents_1.SOCKET_EVENTS.ORDER_COURIER_LOCATION, {
                            deliveryManId,
                            lat,
                            lng,
                        });
                    }
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
                socket.emit("order:reject_ack", { success: true, orderId, result });
            }
            catch (err) {
                socket.emit("error", { message: err.message });
            }
        });
        // Event: courier:offline / disconnect with 30s grace period
        const handleOffline = () => {
            const timer = setTimeout(async () => {
                try {
                    await (0, dispatchEngine_1.removeCourierFromRedis)(deliveryManId);
                    await connection_1.db
                        .update(schema_1.deliveryMen)
                        .set({ isOnline: false })
                        .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, deliveryManId));
                    const [dm] = await connection_1.db
                        .select({ shippingCompanyId: schema_1.deliveryMen.shippingCompanyId })
                        .from(schema_1.deliveryMen)
                        .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, deliveryManId))
                        .limit(1);
                    if (dm?.shippingCompanyId) {
                        (0, exports.notifyShippingCompany)(dm.shippingCompanyId, "courier:status_changed", {
                            deliveryManId,
                            isOnline: false,
                        });
                    }
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
