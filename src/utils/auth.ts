import jwt, { JsonWebTokenError, TokenExpiredError, SignOptions } from 'jsonwebtoken';
import { UnauthorizedError } from '../Errors';
import { TokenPayload, Role } from '../types/custom';
import 'dotenv/config';

// ═══════════════════════════════════════════════════════════════
// ⚙️ CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const JWT_SECRET = process.env.JWT_SECRET as string;

// Token expiration times
const TOKEN_EXPIRY: Record<Role, SignOptions['expiresIn']> = {
  user: '30d',
  admin: '7d',
  restaurant_admin: '7d',
  sales: "30d",
};

// ═══════════════════════════════════════════════════════════════
// 🔐 GENERATE TOKEN
// ═══════════════════════════════════════════════════════════════

interface GenerateTokenInput {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export const generateToken = (data: GenerateTokenInput): string => {
  const payload: TokenPayload = {
    id: data.id,
    name: data.name,
    role: data.role,
  };

  const expiresIn = TOKEN_EXPIRY[data.role];

  return jwt.sign(payload, JWT_SECRET, { expiresIn });
};

// ═══════════════════════════════════════════════════════════════
// ✅ VERIFY TOKEN
// ═══════════════════════════════════════════════════════════════

export const verifyToken = (token: string): TokenPayload => {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      throw new UnauthorizedError('انتهت صلاحية التوكن، يرجى تسجيل الدخول مجدداً');
    }
    if (error instanceof JsonWebTokenError) {
      throw new UnauthorizedError('التوكن غير صالح');
    }
    throw new UnauthorizedError('حدث خطأ في التحقق من التوكن');
  }
};

// ═══════════════════════════════════════════════════════════════
// 📤 EXTRACT TOKEN FROM HEADER
// ═══════════════════════════════════════════════════════════════

export const extractTokenFromHeader = (
  authHeader: string | undefined
): string => {
  if (!authHeader) {
    throw new UnauthorizedError('لم يتم توفير التوكن');
  }

  const [bearer, token] = authHeader.split(' ');

  if (bearer !== 'Bearer' || !token) {
    throw new UnauthorizedError('صيغة التوكن غير صحيحة');
  }

  return token;
};

// ═══════════════════════════════════════════════════════════════
// 🔄 REFRESH TOKEN
// ═══════════════════════════════════════════════════════════════

export const refreshToken = (oldToken: string): string => {
  const decoded = verifyToken(oldToken);

  // Extract only the payload data (exclude iat, exp)
  const payload: TokenPayload = {
    id: decoded.id,
    name: decoded.name,
    role: decoded.role,
  };

  const expiresIn = TOKEN_EXPIRY[payload.role];

  return jwt.sign(payload, JWT_SECRET, { expiresIn });
};

// ═══════════════════════════════════════════════════════════════
// 🔍 DECODE TOKEN (WITHOUT VERIFICATION)
// ═══════════════════════════════════════════════════════════════

export const decodeToken = (token: string): TokenPayload | null => {
  try {
    return jwt.decode(token) as TokenPayload | null;
  } catch {
    return null;
  }
};

// ═══════════════════════════════════════════════════════════════
// ⏰ CHECK IF TOKEN IS EXPIRING SOON
// ═══════════════════════════════════════════════════════════════

export const isTokenExpiringSoon = (
  token: string,
  thresholdHours: number = 24
): boolean => {
  try {
    const decoded = jwt.decode(token) as TokenPayload & { exp?: number };

    if (!decoded?.exp) return false;

    const expirationTime = decoded.exp * 1000; // Convert to milliseconds
    const currentTime = Date.now();
    const thresholdMs = thresholdHours * 60 * 60 * 1000;

    return expirationTime - currentTime < thresholdMs;
  } catch {
    return false;
  }
};

// ═══════════════════════════════════════════════════════════════
// 📊 GET TOKEN EXPIRATION DATE
// ═══════════════════════════════════════════════════════════════

export const getTokenExpiration = (token: string): Date | null => {
  try {
    const decoded = jwt.decode(token) as TokenPayload & { exp?: number };

    if (!decoded?.exp) return null;

    return new Date(decoded.exp * 1000);
  } catch {
    return null;
  }
};