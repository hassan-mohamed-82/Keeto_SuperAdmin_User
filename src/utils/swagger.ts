import fs from 'fs';
import swaggerAutogen from 'swagger-autogen';
import { getTableColumns, is, Table } from 'drizzle-orm';
import * as schema from '../models/schema'; // ⚠️ عدّل المسار للملف اللي فيه كل الـ export * بتاعك

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

const pretty = (s: string) =>
    s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const camel = (s: string) =>
    s.replace(/[-_ ]+(\w)/g, (_, c) => c.toUpperCase());

// لو الاسم الأوتوماتيك غلط لجدول معين، اكتبه هنا: اسم الـ path → اسم الجدول المُصدّر
const resourceToTable: Record<string, string> = {
    // 'countries': 'country',
    // 'select-reasons': 'selectReasons',
};

const SKIP_COLUMNS = new Set(['id', 'createdAt', 'updatedAt', 'created_at', 'updated_at']);

function columnToJson(col: any) {
    let s: any;
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
    if (col.enumValues) s.enum = col.enumValues;
    return s;
}

function findTable(segment: string): Table | undefined {
    const name = resourceToTable[segment];
    const base = camel(segment);
    const singular = base.endsWith('ies')
        ? base.slice(0, -3) + 'y'
        : base.endsWith('s')
            ? base.slice(0, -1)
            : base;

    const candidates = [name, base, singular, base + 's'].filter(Boolean) as string[];
    for (const c of candidates) {
        const t = (schema as any)[c];
        if (t && is(t, Table)) return t;
    }
    return undefined;
}

function tableToBody(table: Table, allOptional: boolean) {
    const cols = getTableColumns(table);
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, col] of Object.entries(cols) as [string, any][]) {
        if (SKIP_COLUMNS.has(key)) continue;
        properties[key] = columnToJson(col);
        if (!allOptional && col.notNull && !col.hasDefault) required.push(key);
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

swaggerAutogen({ openapi: '3.0.0' })(outputFile, endpointsFiles, doc).then(() => {
    const spec = JSON.parse(fs.readFileSync(outputFile, 'utf-8'));
    const tagNames = new Set<string>();
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

        for (const method in spec.paths[path]) {
            const op = spec.paths[path][method];
            op.tags = [tag];
            if (isPublic) op.security = [];

            // body أوتوماتيك من الجدول (POST/PUT بس، ومن غير ما نكتب فوق body موجود)
            if (table && (method === 'post' || method === 'put') && !op.requestBody) {
                op.requestBody = tableToBody(table, method === 'put');
                withBody++;
            }
        }
    }

    spec.tags = [...tagNames].map((name) => ({ name }));

    fs.writeFileSync(outputFile, JSON.stringify(spec, null, 2));
    console.log(`Swagger generated: ${tagNames.size} tags, ${withBody} routes with auto body`);
});