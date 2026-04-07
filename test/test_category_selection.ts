
import { db } from "../src/models/connection";
import { category } from "../src/models/schema/admin/category";

async function testCategorySelection() {
    try {
        console.log("Fetching categories...");
        const categories = await db.select({
            id: category.id,
            name: category.name
        }).from(category);

        console.log("Categories fetched successfully:");
        console.table(categories);

        if (categories.length > 0 && categories[0].id && categories[0].name) {
            console.log("Verification PASSED: Categories have id and name.");
        } else if (categories.length === 0) {
            console.log("Verification PASSED: No categories found (empty list is valid).");
        } else {
            console.log("Verification FAILED: Categories missing required fields.");
        }

    } catch (error) {
        console.error("Verification FAILED with error:", error);
    } finally {
        process.exit(0);
    }
}

testCategorySelection();
