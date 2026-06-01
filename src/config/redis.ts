import Redis, { RedisOptions } from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisConfig: RedisOptions = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    // التعديل هنا: يوقف محاولات الاتصال بعد 3 مرات عشان ميعطلش السيرفر
    retryStrategy: (times) => {
        if (times > 3) {
            console.warn('⚠️ Redis is down. Running App without Cache...');
            return null; // كده هيوقف محاولات الاتصال
        }
        return Math.min(times * 100, 3000);
    }
};

const redisClient = new Redis(redisConfig);

redisClient.on('connect', () => {
    console.log('✅ Redis connected successfully');
});

redisClient.on('error', (err) => {
    // قللنا الإيرور شوية عشان ميزعجكيش في التيرمينال
    console.error(`❌ Redis error: ${err.message}`);
});

export default redisClient;