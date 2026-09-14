import {
    mysqlTable,
    varchar,
    char,
    timestamp,
    decimal,
    mysqlEnum,
    json,
    int
} from "drizzle-orm/mysql-core";
import { sql, relations } from "drizzle-orm";
import { restaurants } from "./restaurants";
import { food } from "./food";

export interface OfferFoodVariationItem {
    variationId?: string | null;
    options: string[]; // option IDs
}

export const offers = mysqlTable("offers", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    restaurantId: char("restaurant_id", { length: 36 }).references(() => restaurants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    image: varchar("image", { length: 500 }),
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date").notNull(),
    price: decimal("price", { precision: 10, scale: 2 }).notNull(),
    foodIds: json("food_ids").$type<string[]>().default([]).notNull(),
    status: mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

export const offerFoods = mysqlTable("offer_foods", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    offerId: char("offer_id", { length: 36 })
        .references(() => offers.id, { onDelete: "cascade" })
        .notNull(),
    foodId: char("food_id", { length: 36 })
        .references(() => food.id, { onDelete: "cascade" })
        .notNull(),
    variations: json("variations").$type<OfferFoodVariationItem[]>().default([]).notNull(),
    optionIds: json("option_ids").$type<string[]>().default([]).notNull(),
    quantity: int("quantity").default(1).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

export const offersRelations = relations(offers, ({ many }) => ({
    offerFoods: many(offerFoods),
}));

export const offerFoodsRelations = relations(offerFoods, ({ one }) => ({
    offer: one(offers, {
        fields: [offerFoods.offerId],
        references: [offers.id],
    }),
    food: one(food, {
        fields: [offerFoods.foodId],
        references: [food.id],
    }),
}));

export type Offer = typeof offers.$inferSelect;
export type NewOffer = typeof offers.$inferInsert;
export type OfferFood = typeof offerFoods.$inferSelect;
export type NewOfferFood = typeof offerFoods.$inferInsert;
