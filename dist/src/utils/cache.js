"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearCachePrefix = exports.deleteCache = exports.getCache = exports.setCache = void 0;
const redis_1 = __importDefault(require("../config/redis"));
const DEFAULT_TTL = 3600; // 1 hour
const setCache = async (key, data, ttl = DEFAULT_TTL) => {
    try {
        const stringifiedData = JSON.stringify(data);
        await redis_1.default.setex(key, ttl, stringifiedData);
    }
    catch (error) {
        console.error(`❌ Redis Set Cache Error [Key: ${key}]:`, error);
    }
};
exports.setCache = setCache;
const getCache = async (key) => {
    try {
        const cachedData = await redis_1.default.get(key);
        if (cachedData) {
            return JSON.parse(cachedData);
        }
        return null;
    }
    catch (error) {
        console.error(`❌ Redis Get Cache Error [Key: ${key}]:`, error);
        return null;
    }
};
exports.getCache = getCache;
const deleteCache = async (key) => {
    try {
        await redis_1.default.del(key);
    }
    catch (error) {
        console.error(`❌ Redis Delete Cache Error [Key: ${key}]:`, error);
    }
};
exports.deleteCache = deleteCache;
const clearCachePrefix = async (prefix) => {
    try {
        const keys = await redis_1.default.keys(`${prefix}:*`);
        if (keys.length > 0) {
            await redis_1.default.del(keys);
        }
    }
    catch (error) {
        console.error(`❌ Redis Clear Cache Prefix Error [Prefix: ${prefix}]:`, error);
    }
};
exports.clearCachePrefix = clearCachePrefix;
