"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promise_1 = __importDefault(require("mysql2/promise"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const databaseName = process.env.DATABASE_NAME || 'exchange';
async function createDatabase() {
    // Connect without specifying a database
    const connection = await promise_1.default.createConnection({
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
    }
    catch (error) {
        console.error('❌ Failed to create database:', error);
        process.exit(1);
    }
    finally {
        await connection.end();
    }
}
createDatabase();
