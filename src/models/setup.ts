import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const databaseName = process.env.DATABASE_NAME || 'exchange';

async function createDatabase() {
    // Connect without specifying a database
    const connection = await mysql.createConnection({
        host: process.env.DATABASE_HOST || 'localhost',
        user: process.env.DATABASE_USER || 'root',
        password: process.env.DATABASE_PASSWORD || '',
    });

    try {
        console.log(`🔄 Creating database '${databaseName}'...`);

        // Create database if it doesn't exist
        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\``);

        console.log(`✅ Database '${databaseName}' created successfully!`);
        console.log('');
        console.log('Next steps:');
        console.log('  1. Run: npm run migrate-db');
        console.log('  2. Run: npm run dev');
    } catch (error) {
        console.error('❌ Failed to create database:', error);
        process.exit(1);
    } finally {
        await connection.end();
    }
}

createDatabase();
