
import {
    mysqlTable,
    varchar,
    timestamp,
    mysqlEnum,
    json,
    char,
    text,decimal,int,
    time
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { food, restaurants, zones } from "../../schema";
export const branches = mysqlTable("branches", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    
    // مربوط بالمطعم الأساسي اللي إنت (كسوبر أدمن) لسه مكريته
    restaurantId: char("restaurant_id", { length: 36 }).references(() => restaurants.id).notNull(),
    
    name: varchar("name", { length: 255 }).notNull(), // فرع مدينة نصر مثلاً
    nameAr: varchar("name_ar", { length: 255 }).notNull().default(''),
    nameFr: varchar("name_fr", { length: 255 }).notNull().default(''),
    address: text("address").notNull(),
    addressAr: text("address_ar").notNull().default(''),
    addressFr: text("address_fr").notNull().default(''),
    phoneNumber: varchar("phone_number", { length: 50 }),
    zoneId: char("zone_id", { length: 36 }).references(() => zones.id).notNull(), // عشان منطقة توصيل الفرع ده
    
    status: mysqlEnum("status", ["active", "inactive"]).default("active"),
    createdAt: timestamp("created_at").defaultNow(),
});


export const branchMenuItems = mysqlTable("branch_menu_items", {
    // 1. المعرف الأساسي
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    
    // ==========================================
    // 2. العلاقات (Relations) - أهم جزء
    // ==========================================
    branchId: char("branch_id", { length: 36 }).references(() => branches.id).notNull(),
    foodId: char("food_id", { length: 36 }).references(() => food.id).notNull(),

    // ==========================================
    // 3. البيانات المتغيرة الخاصة بالفرع (Overrides)
    // ==========================================
    
    // السعر (ممكن يتغير من فرع لفرع لنفس الأكلة)
    price: decimal("price", { precision: 10, scale: 2 }).notNull(),
    
    // نوع المخزون (هل الفرع بيعمل عدد لا نهائي ولا كمية محدودة كل يوم؟)
    stockType: mysqlEnum("stock_type", ["limited", "unlimited"]).default("unlimited"),
    
    // الكمية المتاحة (لو نوع المخزون limited، الرقم ده هيقل مع كل أوردر)
    stockQty: int("stock_qty").default(0), 
    
    // حالة الأكلة في الفرع ده تحديداً
    status: mysqlEnum("status", ["active", "out_of_stock", "inactive"]).default("active"),
    
    // ==========================================
    // 4. التواريخ
    // ==========================================
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});