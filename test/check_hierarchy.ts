
import { db } from "../src/models/connection";
import { category } from "../src/models/schema/admin/category";

async function checkHierarchy() {
    try {
        console.log("Fetching all categories...");
        const allCategories = await db.select().from(category);
        console.table(allCategories.map(c => ({ id: c.id, name: c.name, parent: c.parentCategoryId })));

    } catch (error) {
        console.error("Error:", error);
    } finally {
        process.exit(0);
    }
}

checkHierarchy();
