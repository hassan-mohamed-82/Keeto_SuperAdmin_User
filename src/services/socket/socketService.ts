import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { verifyToken } from "../../utils/auth";
import { db } from "../../models/connection";
import { deliveryMen, orders, shippingCompanies } from "../../models/schema";
import { eq, and, inArray } from "drizzle-orm";
import { updateCourierRedisLocation, removeCourierFromRedis, rejectOrderByCourier } from "../shipping/dispatchEngine";
import { SOCKET_EVENTS } from "./socketEvents";

let io: Server | null = null;

// Track last DB write time per courier to save coordinates to MySQL every 30s
const lastDbWriteTimeMap = new Map<string, number>();

// Grace period timers upon disconnect (30s grace)
const disconnectGraceTimers = new Map<string, NodeJS.Timeout>();

// Performance Caches: Cache courier profile & active orders in memory to avoid hammering MySQL
interface CourierMetaCache {
    shippingCompanyId: string | null;
    name: string | null;
    phone: string | null;
    cachedAt: number;
}

interface CourierOrdersCache {
    orders: { id: string; orderNumber: string | null; shippingStatus: string | null }[];
    cachedAt: number;
}

const courierMetaCache = new Map<string, CourierMetaCache>();
const courierOrdersCache = new Map<string, CourierOrdersCache>();

export const invalidateCourierCache = (deliveryManId: string) => {
    courierOrdersCache.delete(deliveryManId);
    courierMetaCache.delete(deliveryManId);
};

const getCourierMeta = async (deliveryManId: string): Promise<CourierMetaCache> => {
    const cached = courierMetaCache.get(deliveryManId);
    const now = Date.now();
    if (cached && now - cached.cachedAt < 5 * 60 * 1000) {
        return cached;
    }
    const [dm] = await db
        .select({
            shippingCompanyId: deliveryMen.shippingCompanyId,
            name: deliveryMen.name,
            phone: deliveryMen.phone,
        })
        .from(deliveryMen)
        .where(eq(deliveryMen.id, deliveryManId))
        .limit(1);

    const meta: CourierMetaCache = {
        shippingCompanyId: dm?.shippingCompanyId || null,
        name: dm?.name || null,
        phone: dm?.phone || null,
        cachedAt: now,
    };
    courierMetaCache.set(deliveryManId, meta);
    return meta;
};

const getCourierActiveOrders = async (deliveryManId: string) => {
    const cached = courierOrdersCache.get(deliveryManId);
    const now = Date.now();
    if (cached && now - cached.cachedAt < 15 * 1000) {
        return cached.orders;
    }
    const activeOrders = await db
        .select({
            id: orders.id,
            orderNumber: orders.orderNumber,
            shippingStatus: orders.shippingStatus,
        })
        .from(orders)
        .where(
            and(
                eq(orders.deliveryManId, deliveryManId),
                inArray(orders.shippingStatus, ["assigned", "picked_up"])
            )
        );

    courierOrdersCache.set(deliveryManId, { orders: activeOrders, cachedAt: now });
    return activeOrders;
};

export const initSocket = (httpServer: HttpServer): Server => {
    io = new Server(httpServer, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
        },
    });

    // -------------------------------------------------------------
    // Phase 7.1: Mandatory Authentication Middleware
    // -------------------------------------------------------------
    const authMiddleware = (socket: Socket, next: (err?: Error) => void) => {
        try {
            let rawToken =
                socket.handshake.auth?.token ||
                socket.handshake.headers?.authorization ||
                (socket.handshake.query?.token as string);

            if (!rawToken) {
                return next(new Error("Authentication error: No token provided"));
            }

            const token = typeof rawToken === "string" && rawToken.startsWith("Bearer ")
                ? rawToken.slice(7).trim()
                : String(rawToken).trim();

            const decoded = verifyToken(token);
            if (!decoded || !decoded.id || !decoded.role) {
                return next(new Error("Authentication error: Invalid token"));
            }

            socket.data.user = decoded;
            next();
        } catch (error: any) {
            return next(new Error(`Authentication error: ${error.message}`));
        }
    };

    io.use(authMiddleware);

    // =========================================================================
    // Courier Connection Handler (Used by both main IO and /courier namespace)
    // =========================================================================
    const handleCourierConnection = (socket: Socket) => {
        const user = socket.data.user;

        // Phase 7: Only couriers are handled here
        if (user?.role !== "delivery_man") {
            socket.disconnect(true);
            return;
        }

        const deliveryManId = user.deliveryManId || user.id;

        // Cancel grace timer if reconnected
        if (deliveryManId && disconnectGraceTimers.has(deliveryManId)) {
            clearTimeout(disconnectGraceTimers.get(deliveryManId)!);
            disconnectGraceTimers.delete(deliveryManId);
        }

        // Join courier personal room
        socket.join(`courier:${deliveryManId}`);

        // Event: courier:online
        socket.on(SOCKET_EVENTS.COURIER_ONLINE, async () => {
            try {
                if (disconnectGraceTimers.has(deliveryManId)) {
                    clearTimeout(disconnectGraceTimers.get(deliveryManId)!);
                    disconnectGraceTimers.delete(deliveryManId);
                }

                await db
                    .update(deliveryMen)
                    .set({ isOnline: true })
                    .where(eq(deliveryMen.id, deliveryManId));

                const meta = await getCourierMeta(deliveryManId);
                if (meta.shippingCompanyId) {
                    notifyShippingCompany(meta.shippingCompanyId, "courier:status_changed", {
                        deliveryManId,
                        isOnline: true,
                    });
                }
            } catch (err) {
                console.error("Error setting courier online:", err);
            }
        });

        // Event: courier:location (Optimized with In-Memory Caching)
        socket.on(SOCKET_EVENTS.COURIER_LOCATION, async (payload: { lat: number; lng: number }) => {
            try {
                const { lat, lng } = payload;
                if (lat === undefined || lng === undefined) return;

                // 1. Update Redis GEO & alive key (TTL 60s)
                await updateCourierRedisLocation(deliveryManId, lat, lng);

                // 2. Fetch cached profile and active orders (0-1 DB queries instead of 2 on every ping)
                const [meta, activeOrders] = await Promise.all([
                    getCourierMeta(deliveryManId),
                    getCourierActiveOrders(deliveryManId),
                ]);

                // Broadcast to company dashboard live map (includes courier details & active orders)
                if (meta.shippingCompanyId) {
                    notifyShippingCompany(meta.shippingCompanyId, SOCKET_EVENTS.DELIVERY_LOCATION_CHANGED, {
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
                    notifyOrderTracking(ord.id, SOCKET_EVENTS.ORDER_COURIER_LOCATION, {
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
                    await db
                        .update(deliveryMen)
                        .set({
                            currentLat: String(lat),
                            currentLng: String(lng),
                            lastLocationUpdate: new Date(),
                        })
                        .where(eq(deliveryMen.id, deliveryManId));
                }
            } catch (err) {
                console.error("Error updating courier location:", err);
            }
        });

        // Event: order:reject
        socket.on(SOCKET_EVENTS.COURIER_REJECT, async (payload: { orderId: string; reason: string }) => {
            try {
                const { orderId, reason } = payload;
                if (!orderId || !reason) {
                    socket.emit("error", { message: "orderId and reason are required" });
                    return;
                }
                const result = await rejectOrderByCourier(orderId, deliveryManId, reason);
                invalidateCourierCache(deliveryManId);
                socket.emit("order:reject_ack", { success: true, orderId, result });
            } catch (err: any) {
                socket.emit("error", { message: err.message });
            }
        });

        // Event: courier:offline / disconnect with 30s grace period & multi-device check
        const handleOffline = () => {
            // Cancel existing timer if any (prevents double callbacks / race condition)
            if (disconnectGraceTimers.has(deliveryManId)) {
                clearTimeout(disconnectGraceTimers.get(deliveryManId)!);
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

                    await removeCourierFromRedis(deliveryManId);
                    await db
                        .update(deliveryMen)
                        .set({ isOnline: false })
                        .where(eq(deliveryMen.id, deliveryManId));

                    const meta = await getCourierMeta(deliveryManId);
                    if (meta.shippingCompanyId) {
                        notifyShippingCompany(meta.shippingCompanyId, "courier:status_changed", {
                            deliveryManId,
                            isOnline: false,
                        });
                    }

                    invalidateCourierCache(deliveryManId);
                    disconnectGraceTimers.delete(deliveryManId);
                } catch (err) {
                    console.error("Error setting courier offline after grace period:", err);
                }
            }, 30000);

            disconnectGraceTimers.set(deliveryManId, timer);
        };

        socket.on(SOCKET_EVENTS.COURIER_OFFLINE, handleOffline);
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
    io.on("connection", async (socket: Socket) => {
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
        socket.on(SOCKET_EVENTS.ORDER_TRACK, async (data: { orderId: string }) => {
            try {
                const { orderId } = data;
                if (!orderId) return;

                // Verify access to track order
                const [ord] = await db
                    .select({
                        id: orders.id,
                        userId: orders.userId,
                        restaurantId: orders.restaurantId,
                        shippingCompanyId: orders.shippingCompanyId,
                        deliveryManId: orders.deliveryManId,
                    })
                    .from(orders)
                    .where(eq(orders.id, orderId))
                    .limit(1);

                if (!ord) return;

                const isCustomer = user.role === "user" && ord.userId === user.id;
                const isSuperAdmin = user.role === "admin" && user.type === "super_admin";
                const isRest = (user.role === "restaurant_admin" || user.restaurantId) && ord.restaurantId === user.restaurantId;
                const isCompany = user.role === "shipping_company" && ord.shippingCompanyId === user.shippingCompanyId;
                const isCourier = user.role === "delivery_man" && ord.deliveryManId === (user.deliveryManId || user.id);

                if (isCustomer || isSuperAdmin || isRest || isCompany || isCourier) {
                    socket.join(`order:track:${orderId}`);
                    socket.emit("order:track:joined", { orderId, success: true });
                } else {
                    socket.emit("error", { message: "Unauthorized to track this order" });
                }
            } catch (err) {
                console.error("Error joining order track room:", err);
            }
        });
    });

    return io;
};

export const getIO = (): Server => {
    if (!io) {
        throw new Error("Socket.io has not been initialized. Call initSocket first.");
    }
    return io;
};

// =========================================================================
// Helpers for broadcasting
// =========================================================================
export const notifyDeliveryMan = (deliveryManId: string, event: string, data: any) => {
    if (io) {
        io.to(`courier:${deliveryManId}`).emit(event, data);
        io.of("/courier").to(`courier:${deliveryManId}`).emit(event, data);
    }
};

export const notifyShippingCompany = (companyId: string, event: string, data: any) => {
    if (io) {
        io.to(`shipping_company:${companyId}`).emit(event, data);
    }
};

export const notifyRestaurant = (restaurantId: string, event: string, data: any) => {
    if (io) {
        io.to(`restaurant:${restaurantId}`).emit(event, data);
    }
};

export const notifyAdmins = (event: string, data: any) => {
    if (io) {
        io.to("superadmin:room").emit(event, data);
    }
};

export const notifyOrderTracking = (orderId: string, event: string, data: any) => {
    if (io) {
        io.to(`order:track:${orderId}`).emit(event, data);
    }
};
