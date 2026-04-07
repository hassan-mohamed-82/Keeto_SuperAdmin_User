import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const databaseName = process.env.DATABASE_NAME || 'mathhouse';

async function resetDatabase() {
    // Connect without specifying a database
    const connection = await mysql.createConnection({
        host: process.env.DATABASE_HOST || 'localhost',
        user: process.env.DATABASE_USER || 'root',
        password: process.env.DATABASE_PASSWORD || '',
    });

    try {
        console.log(`🗑️ Dropping database '${databaseName}'...`);
        await connection.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
        console.log(`✅ Database '${databaseName}' dropped successfully!`);

        console.log(`🔄 Creating database '${databaseName}'...`);
        await connection.query(`CREATE DATABASE \`${databaseName}\``);
        console.log(`✅ Database '${databaseName}' created successfully!`);

    } catch (error) {
        console.error('❌ Failed to reset database:', error);
        process.exit(1);
    } finally {
        await connection.end();
        process.exit(0);
    }
}

resetDatabase();
