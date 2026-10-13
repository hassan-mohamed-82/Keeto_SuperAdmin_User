export const SOCKET_EVENTS = {
    // Courier events
    COURIER_ONLINE: "courier:online",
    COURIER_LOCATION: "courier:location",
    COURIER_OFFLINE: "courier:offline",
    COURIER_ASSIGNED: "order:assigned",
    COURIER_REJECT: "order:reject",

    // Shipping company events
    ORDER_ASSIGNED: "order:assigned",
    ORDER_MANUAL_REQUIRED: "order:manual_required",
    ORDER_STATUS_CHANGED: "order:status_changed",
    DELIVERY_LOCATION_CHANGED: "delivery:location_changed",
    DELIVERY_SHIFT_CHANGED: "delivery:shift_changed",

    // Tracking / Room events
    ORDER_TRACK: "order:track",
    ORDER_COURIER_ASSIGNED: "order:courier_assigned",
    ORDER_COURIER_LOCATION: "order:courier_location",
    ORDER_PICKED_UP: "order:picked_up",
    ORDER_DELIVERED: "order:delivered",

    // System notifications
    NOTIFICATION: "notification",
} as const;
