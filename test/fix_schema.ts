
import { db } from "../src/models/connection";
import { sql } from "drizzle-orm";

async function fixSchema() {
    try {
        console.log("Applying manual schema fix...");

        // Check if column exists first to avoid error
        const checkQuery = sql`
            SELECT COUNT(*) as count 
            FROM information_schema.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = 'category' 
            AND COLUMN_NAME = 'parent_category_id';
        `;

        const [result]: any = await db.execute(checkQuery);

        if (result[0].count == 0) {
            console.log("Column parent_category_id does not exist. Adding it...");
            await db.execute(sql`
                ALTER TABLE category 
                ADD COLUMN parent_category_id CHAR(255) NULL,
                ADD CONSTRAINT fk_category_parent 
                FOREIGN KEY (parent_category_id) REFERENCES category(id);
             `);
            console.log("Column added successfully.");
        } else {
            console.log("Column parent_category_id already exists.");
        }

    } catch (error) {
        console.error("Schema fix failed:", error);
    } finally {
        process.exit(0);
    }
}

fixSchema();
