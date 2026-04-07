
import { db } from "../src/models/connection";
import { category } from "../src/models/schema";
import { sql, eq } from "drizzle-orm";

async function testHierarchy() {
    try {
        console.log("Creating hierarchy: Grandparent -> Parent -> Child");

        // Helper to insert and get ID (since MySQL doesn't fully support RETURNING in all versions/drivers via Drizzle)
        const insertAndGetId = async (values: { name: string, description: string, parentCategoryId?: string }) => {
            await db.insert(category).values(values);
            const [inserted] = await db.select().from(category).where(eq(category.name, values.name));
            return inserted.id;
        };

        // 1. Create Grandparent
        // Use random suffix to avoid collision
        const suffix = Math.floor(Math.random() * 10000);

        const gpName = `Grandparent-${suffix}`;
        const gpId = await insertAndGetId({
            name: gpName,
            description: "Top level",
        });
        console.log(`Created Grandparent: ${gpId}`);

        // 2. Create Parent
        const pName = `Parent-${suffix}`;
        const pId = await insertAndGetId({
            name: pName,
            description: "Mid level",
            parentCategoryId: gpId
        });
        console.log(`Created Parent: ${pId}`);

        // 3. Create Child
        const cName = `Child-${suffix}`;
        const cId = await insertAndGetId({
            name: cName,
            description: "Low level",
            parentCategoryId: pId
        });
        console.log(`Created Child: ${cId}`);


        console.log("\n--- Testing Recursive CTE for Child ---");

        // CTE Query
        const query = sql`
            WITH RECURSIVE category_path AS (
                SELECT id, name, parent_category_id, 0 as level
                FROM category
                WHERE id = ${cId}
                UNION ALL
                SELECT c.id, c.name, c.parent_category_id, cp.level + 1
                FROM category c
                JOIN category_path cp ON c.id = cp.parent_category_id
            )
            SELECT * FROM category_path ORDER BY level;
        `;

        const result = await db.execute(query);
        console.log("Result:", result[0]);

        console.log("\n--- Testing getAllCategory In-Memory Lineage ---");

        // Simulate fetching all categories
        const allCategories = await db.select().from(category);

        // 1. Build Map
        const categoryMap = new Map<string, typeof allCategories[0]>();
        allCategories.forEach(cat => categoryMap.set(cat.id, cat));

        // 2. Build Lineage
        const lineageResult = allCategories.map(cat => {
            const ancestors: { id: string, name: string }[] = [];
            let current = cat;

            // Loop up until no parent
            while (current.parentCategoryId) {
                const parent = categoryMap.get(current.parentCategoryId);
                if (parent) {
                    ancestors.push({ id: parent.id, name: parent.name });
                    current = parent;
                } else {
                    break; // Parent invalid or missing in fetched set
                }
            }
            return {
                id: cat.id,
                name: cat.name,
                ancestors // Should be [Parent, Grandparent] for Child
            };
        });

        // Find our child in the result
        const childLineageResult = lineageResult.find(r => r.id === cId);
        console.log("Child Lineage (In-Memory):", childLineageResult?.ancestors);

        if (childLineageResult?.ancestors.length !== 2) {
            console.error("FAILED: Expected 2 ancestors for Child");
        } else {
            console.log("PASSED: Ancestor count correct");
        }

        console.log("\n--- Cleanup ---");
        await db.delete(category).where(eq(category.id, cId));
        await db.delete(category).where(eq(category.id, pId));
        await db.delete(category).where(eq(category.id, gpId));
        console.log("Cleanup done.");

    } catch (error) {
        console.error("Test failed:", error);
    } finally {
        process.exit(0);
    }
}

testHierarchy();
