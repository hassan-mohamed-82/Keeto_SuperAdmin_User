import redisClient from '../config/redis';

const DEFAULT_TTL = 3600; // 1 hour

export const setCache = async (key: string, data: any, ttl: number = DEFAULT_TTL) => {
    try {
        const stringifiedData = JSON.stringify(data);
        await redisClient.setex(key, ttl, stringifiedData);
    } catch (error) {
        console.error(`❌ Redis Set Cache Error [Key: ${key}]:`, error);
    }
};

export const getCache = async <T>(key: string): Promise<T | null> => {
    try {
        const cachedData = await redisClient.get(key);
        if (cachedData) {
            return JSON.parse(cachedData) as T;
        }
        return null;
    } catch (error) {
        console.error(`❌ Redis Get Cache Error [Key: ${key}]:`, error);
        return null;
    }
};

export const deleteCache = async (key: string) => {
    try {
        await redisClient.del(key);
    } catch (error) {
        console.error(`❌ Redis Delete Cache Error [Key: ${key}]:`, error);
    }
};

export const clearCachePrefix = async (prefix: string) => {
    try {
        const keys = await redisClient.keys(`${prefix}:*`);
        if (keys.length > 0) {
            await redisClient.del(keys);
        }
    } catch (error) {
         console.error(`❌ Redis Clear Cache Prefix Error [Prefix: ${prefix}]:`, error);
    }
};
