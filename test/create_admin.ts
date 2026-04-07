import { db } from "../src/models/connection";
import { admins } from "../src/models/schema/admin/admin";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";

const createAdmin = async () => {
    try {
        const email = "admin@mathhouse.com";
        const password = "password123";
        const name = "Super Admin";

        // Check if admin already exists
        const existingAdmin = await db.select().from(admins).where(eq(admins.email, email));

        if (existingAdmin.length > 0) {
            console.log("Admin already exists");
            return;
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await db.insert(admins).values({
            name,
            email,
            password: hashedPassword,
            role: "admin",
        });

        console.log("Admin created successfully");
    } catch (error) {
        console.error("Error creating admin:", error);
    } finally {
        process.exit(0);
    }
};

createAdmin();
