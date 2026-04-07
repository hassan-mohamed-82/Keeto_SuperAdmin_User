import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import * as schema from './schema';

dotenv.config();

// MySQL connection pool
const pool = mysql.createPool({
  host: process.env.DATABASE_HOST,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
});

// Drizzle instance
export const db = drizzle(pool, { schema, mode: 'default' });

// Connection function (for backwards compatibility)
export const connectDB = async () => {
  try {
    // Test connection
    const connection = await pool.getConnection();
    console.log('✅ MySQL connected successfully');
    connection.release();
  } catch (error) {
    console.error('❌ MySQL connection failed:', error);
    process.exit(1);
  }
};

export { pool };
