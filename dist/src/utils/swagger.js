"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const swagger_autogen_1 = __importDefault(require("swagger-autogen"));
const drizzle_orm_1 = require("drizzle-orm");
const schema = __importStar(require("../models/schema")); // ⚠️ عدّل المسار للملف اللي فيه كل الـ export * بتاعك
const doc = {
    info: {
        title: 'Suparadmin & User API',
        description: 'API Documentation',
    },
    servers: [
        { url: process.env.Back_BASE_URL ?? 'http://localhost:3000', description: 'Main' },
        { url: 'http://localhost:3000', description: 'Local' },
    ],
    components: {
        securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
    },
    security: [{ bearerAuth: [] }],
};
const outputFile = './src/swagger-output.json';
const endpointsFiles = ['./src/server.ts'];
/* ---------- helpers ---------- */
const pretty = (s) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const camel = (s) => s.replace(/[-_ ]+(\w)/g, (_, c) => c.toUpperCase());
// لو الاسم الأوتوماتيك غلط لجدول معين، اكتبه هنا: اسم الـ path → اسم الجدول المُصدّر
const resourceToTable = {
// 'countries': 'country',
// 'select-reasons': 'selectReasons',
};
const SKIP_COLUMNS = new Set(['id', 'createdAt', 'updatedAt', 'created_at', 'updated_at']);
function columnToJson(col) {
    let s;
    switch (col.dataType) {
        case 'number':
            s = { type: /int|serial/i.test(col.columnType) ? 'integer' : 'number' };
            break;
        case 'bigint':
            s = { type: 'integer' };
            break;
        case 'boolean':
            s = { type: 'boolean' };
            break;
        case 'date':
            s = { type: 'string', format: 'date-time' };
            break;
        case 'json':
            s = { type: 'object' };
            break;
        case 'array':
            s = { type: 'array', items: { type: 'string' } };
            break;
        default:
            s = { type: 'string' };
    }
    if (col.enumValues)
        s.enum = col.enumValues;
    return s;
}
function findTable(segment) {
    const name = resourceToTable[segment];
    const base = camel(segment);
    const singular = base.endsWith('ies')
        ? base.slice(0, -3) + 'y'
        : base.endsWith('s')
            ? base.slice(0, -1)
            : base;
    const candidates = [name, base, singular, base + 's'].filter(Boolean);
    for (const c of candidates) {
        const t = schema[c];
        if (t && (0, drizzle_orm_1.is)(t, drizzle_orm_1.Table))
            return t;
    }
    return undefined;
}
function tableToBody(table, allOptional) {
    const cols = (0, drizzle_orm_1.getTableColumns)(table);
    const properties = {};
    const required = [];
    for (const [key, col] of Object.entries(cols)) {
        if (SKIP_COLUMNS.has(key))
            continue;
        properties[key] = columnToJson(col);
        if (!allOptional && col.notNull && !col.hasDefault)
            required.push(key);
    }
    return {
        required: true,
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    properties,
                    ...(required.length ? { required } : {}),
                },
            },
        },
    };
}
/* ---------- generate ---------- */
(0, swagger_autogen_1.default)({ openapi: '3.0.0' })(outputFile, endpointsFiles, doc).then(() => {
    const spec = JSON.parse(fs_1.default.readFileSync(outputFile, 'utf-8'));
    const tagNames = new Set();
    let withBody = 0;
    for (const path in spec.paths) {
        // /api/superadmin/roles/{id} → ['api', 'superadmin', 'roles', '{id}']
        const parts = path.split('/').filter(Boolean);
        const group = parts[1] ? pretty(parts[1]) : 'General';
        const resourceSeg = parts[2] && !parts[2].startsWith('{') ? parts[2] : '';
        const tag = resourceSeg ? `${group} / ${pretty(resourceSeg)}` : group;
        tagNames.add(tag);
        const table = resourceSeg ? findTable(resourceSeg) : undefined;
        const isPublic = parts.includes('auth'); // routes الـ login/register مش محتاجة token
        // الـ body الافتراضي لو مفيش جدول
        const genericBody = {
            required: true,
            content: {
                'application/json': {
                    schema: { type: 'object', additionalProperties: true },
                    example: {},
                },
            },
        };
        for (const method in spec.paths[path]) {
            const op = spec.paths[path][method];
            op.tags = [tag];
            if (isPublic)
                op.security = [];
            const hasBody = ['post', 'put', 'patch'].includes(method);
            if (hasBody && !op.requestBody) {
                op.requestBody = table
                    ? tableToBody(table, method !== 'post') // الجدول لو لقاه
                    : genericBody; // وإلا body فاضي تكتب فيه
            }
        }
    }
    spec.tags = [...tagNames].map((name) => ({ name }));
    fs_1.default.writeFileSync(outputFile, JSON.stringify(spec, null, 2));
    console.log(`Swagger generated: ${tagNames.size} tags, ${withBody} routes with auto body`);
});
