"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserIpAndCountry = void 0;
const axios_1 = __importDefault(require("axios"));
/**
 * Extracts the user's IP address from the request and determines their country.
 * Uses x-forwarded-for or request IP, and checks Cloudflare headers before falling back to ip-api.com.
 * @param req Express Request object
 * @returns Object containing the IP address and country
 */
const getUserIpAndCountry = async (req) => {
    // 1. Get IP address
    const forwardedFor = req.headers['x-forwarded-for'];
    let ip = 'Unknown IP';
    if (typeof forwardedFor === 'string') {
        ip = forwardedFor.split(',')[0].trim();
    }
    else if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
        ip = forwardedFor[0].trim();
    }
    else if (req.ip) {
        ip = req.ip;
    }
    else if (req.socket?.remoteAddress) {
        ip = req.socket.remoteAddress;
    }
    // 2. Try to get country from proxy/CDN headers (e.g., Cloudflare)
    const countryHeader = req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'];
    if (typeof countryHeader === 'string') {
        return { ip, country: countryHeader };
    }
    // 3. Fallback to external IP geolocation API
    try {
        // Clean up IPv6 mapped IPv4 addresses (e.g., ::ffff:192.168.1.1)
        const cleanIp = ip.replace(/^.*:/, '');
        // Skip external API call for localhost
        if (cleanIp === '127.0.0.1' ||
            cleanIp === '1' ||
            cleanIp === 'Unknown IP' ||
            cleanIp.startsWith('192.168.') ||
            cleanIp.startsWith('10.')) {
            return { ip, country: 'Local' };
        }
        // Use axios to fetch country from ip-api.com
        const response = await axios_1.default.get(`http://ip-api.com/json/${cleanIp}`);
        if (response.data && response.data.status === 'success') {
            return { ip, country: response.data.country };
        }
    }
    catch (error) {
        console.error('Error fetching country by IP:', error instanceof Error ? error.message : error);
    }
    return { ip, country: null };
};
exports.getUserIpAndCountry = getUserIpAndCountry;
