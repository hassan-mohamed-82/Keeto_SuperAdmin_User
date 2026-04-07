import axios from 'axios';
import { networkInterfaces } from 'os';
import { Request } from 'express';
import { getUserIpAndCountry } from '../src/utils/IPAddress';

function getCurrentLocalIp(): string {
    const interfaces = networkInterfaces();

    for (const networkInterface of Object.values(interfaces)) {
        if (!networkInterface) {
            continue;
        }

        for (const address of networkInterface) {
            if (address.family === 'IPv4' && !address.internal) {
                return address.address;
            }
        }
    }

    return '127.0.0.1';
}

async function getCurrentPublicIp(): Promise<string | null> {
    try {
        const response = await axios.get<{ ip: string }>('https://api.ipify.org?format=json');
        return response.data.ip;
    } catch (error) {
        console.error('Unable to fetch public IP:', error instanceof Error ? error.message : error);
        return null;
    }
}

async function runTests() {
    console.log('=== Testing Current IP and Country Extraction ===\n');

    const localIp = getCurrentLocalIp();
    const publicIp = await getCurrentPublicIp();

    const requestLike = {
        headers: publicIp ? { 'x-forwarded-for': publicIp } : {},
        ip: localIp,
        socket: {
            remoteAddress: localIp,
        },
    } as unknown as Request;

    console.log('Local IP:', localIp);
    console.log('Public IP:', publicIp ?? 'Unavailable');

    const result = await getUserIpAndCountry(requestLike);
    console.log('Resolved IP info:', result);
    console.log('--------------------------------------------------');
}

runTests();
