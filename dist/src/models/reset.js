"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promise_1 = __importDefault(require("mysql2/promise"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const databaseName = process.env.DATABASE_NAME || 'mathhouse';
async function resetDatabase() {
    // Connect without specifying a database
    const connection = await promise_1.default.createConnection({
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
    }
    catch (error) {
        console.error('❌ Failed to reset database:', error);
        process.exit(1);
    }
    finally {
        await connection.end();
        process.exit(0);
    }
}
resetDatabase();
