import { db } from "./src/models/connection";
import { restaurantZoneDeliveryFees } from "./src/models/schema";

async function checkData() {
    const data = await db.select().from(restaurantZoneDeliveryFees);
    console.log("Total records in restaurant_zone_delivery_fees:", data.length);
    if (data.length > 0) {
        console.log("Sample record:", data[0]);
    }
    process.exit(0);
}

checkData();
