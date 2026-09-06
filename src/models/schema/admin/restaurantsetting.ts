import { sql } from "drizzle-orm";
import {
  mysqlTable,
  int,
  boolean,
  varchar,
  decimal,
  mysqlEnum,
  char,
  json
} from "drizzle-orm/mysql-core";

// 1. جدول الإعدادات العامة
export const restaurantSettings = mysqlTable("restaurant_settings", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: char("restaurant_id", { length: 36 }).notNull().unique(),

  foodManagement: boolean("food_management").default(true),
  scheduledDelivery: boolean("scheduled_delivery").default(false),
  reviewsSection: boolean("reviews_section").default(true),
  posSection: boolean("pos_section").default(false),
  selfDelivery: boolean("self_delivery").default(false),
  homeDelivery: boolean("home_delivery").default(true),
  takeaway: boolean("takeaway").default(false),
  orderSubscription: boolean("order_subscription").default(false),
  instantOrder: boolean("instant_order").default(false),
  halalTagStatus: boolean("halal_tag_status").default(false),
  dineIn: boolean("dine_in").default(false),
  firstColor: varchar("first_color", { length: 20 }),
  secondColor: varchar("second_color", { length: 20 }),

  firstTextColor: varchar("first_text_color", { length: 20 }),
  secondTextColor: varchar("second_text_color", { length: 20 }),

  vegType: mysqlEnum("veg_type", ["VEG", "NON_VEG", "BOTH"]).default("BOTH"),
  canEditOrder: boolean("can_edit_order").default(false),
  minOrderAmount: decimal("min_order_amount", { precision: 10, scale: 2 }).default("0.00"),

  minDeliveryTime: int("min_delivery_time").default(15),
  maxDeliveryTime: int("max_delivery_time").default(25),

  minTakeAwayTime: int("min_take_away_time").default(15),
  maxTakeAwayTime: int("max_take_away_time").default(25),

  minDineInTime: int("min_dine_in_time").default(15),
  maxDineInTime: int("max_dine_in_time").default(25),

  isAlwaysOpen: boolean("is_always_open").default(false),
  isSameTimeEveryDay: boolean("is_same_time_every_day").default(false),

  isTemporarilyClosed: boolean("is_temporarily_closed").default(false),

  repeatNotification: boolean("repeat_notification").default(false),
  repeatNotificationDuration: int("repeat_notification_duration").default(20),
  repeatNotificationStatuses: json("repeat_notification_statuses")
    .$type<string[]>()
    .default(["pending"]), // pending, accepted, preparing, out_for_delivery

  resetDailyOrderNumberTime: varchar("reset_daily_order_number_time", { length: 5 }),
});


// 2. جدول مواعيد العمل (يدعم الفترات المتعددة)
export const restaurantSchedules = mysqlTable("restaurant_schedules", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: char("restaurant_id", { length: 36 }).notNull(),
  dayOfWeek: int("day_of_week").notNull(), // 0 = الأحد, 1 = الإثنين ... 6 = السبت
  isOffDay: boolean("is_off_day").default(false),
  openingTime: varchar("opening_time", { length: 5 }), // مثلاً: "09:00"
  closingTime: varchar("closing_time", { length: 5 }), // مثلاً: "23:00"
});