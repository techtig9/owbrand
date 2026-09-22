import { publicEnv } from '@/lib/env';

/**
 * The OpenAPI description of /api/v1.
 *
 * Hand-written rather than generated from the Zod schemas, which is a
 * deliberate trade: generated specs stay in sync automatically and describe
 * only shapes. What an integrator needs is the part a generator cannot infer —
 * that an inaccessible brand id returns an empty list rather than a 403, that
 * the cursor is a timestamp, that 503 means the deployment is unconfigured
 * rather than broken. Those are written here as prose, and the column contract
 * test in the database suite is what stops the shapes drifting.
 *
 * It describes ONLY what exists. There is no write endpoint documented as
 * "coming soon": a spec that lists an endpoint returning 404 is worse than a
 * shorter spec, because a client generator will happily build a method for it.
 */
export function openApiDocument(): Record<string, unknown> {
  const server = `${publicEnv.siteUrl.replace(/\/$/, '')}/api/v1`;

  const paginationParams = [
    {
      name: 'limit',
      in: 'query',
      description: 'Maximum rows to return. Defaults to 25, capped at 100.',
      schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    },
    {
      name: 'cursor',
      in: 'query',
      description:
        'The `nextCursor` from a previous response — an ISO timestamp. Cursor paging is used rather than offsets because a row inserted between two requests would shift an offset page, showing one item twice and skipping another. An unparseable cursor is ignored and paging restarts.',
      schema: { type: 'string', format: 'date-time' },
    },
  ];

  const listResponse = (itemsRef: string) => ({
    '200': {
      description: 'A page of results.',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['data', 'nextCursor'],
            properties: {
              data: { type: 'array', items: { $ref: itemsRef } },
              nextCursor: {
                type: 'string',
                format: 'date-time',
                nullable: true,
                description: 'Null when there is no further page, so a `while (cursor)` loop terminates.',
              },
            },
          },
        },
      },
    },
    '401': { $ref: '#/components/responses/Unauthorized' },
    '403': { $ref: '#/components/responses/Forbidden' },
    '429': { $ref: '#/components/responses/RateLimited' },
  });

  return {
    openapi: '3.1.0',
    info: {
      title: 'OwBrand API',
      version: '1.0.0',
      description: [
        'Read access to the brands, posts and generated content on your account.',
        '',
        'Authenticate with an API key from Settings → API keys, sent as',
        '`Authorization: Bearer owb_live_…`. The key is shown once at creation and',
        'stored only as a hash, so it cannot be recovered — issue a new one instead.',
        '',
        'This version is read-only. Write endpoints are not documented here because',
        'they do not exist; a spec listing an endpoint that 404s is worse than a',
        'short spec, since a generator will build a client method for it.',
      ].join('\n'),
    },
    servers: [{ url: server }],
    security: [{ apiKey: [] }],
    paths: {
      '/brands': {
        get: {
          summary: 'List brands',
          description: 'The brands this key can access, newest first.',
          parameters: paginationParams,
          responses: listResponse('#/components/schemas/Brand'),
        },
      },
      '/posts': {
        get: {
          summary: 'List social posts',
          description:
            'Scheduled and published posts. A `brandId` you cannot access returns an empty list rather than a 403 — a 403 would confirm that brand exists, which is more than the caller is entitled to know about another account.',
          parameters: [
            ...paginationParams,
            {
              name: 'brandId',
              in: 'query',
              schema: { type: 'string', format: 'uuid' },
            },
            {
              name: 'status',
              in: 'query',
              schema: { type: 'string', enum: ['draft', 'scheduled', 'queued', 'published', 'failed'] },
            },
          ],
          responses: listResponse('#/components/schemas/Post'),
        },
      },
      '/content': {
        get: {
          summary: 'List generated content',
          parameters: paginationParams,
          responses: listResponse('#/components/schemas/ContentAsset'),
        },
      },
    },
    components: {
      securitySchemes: {
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          description: 'An API key issued from Settings → API keys. Requires the `read` scope.',
        },
      },
      responses: {
        Unauthorized: {
          description:
            'Missing, malformed, revoked or expired key. All four return the same message on purpose: distinguishing them tells a caller which of their guesses was once a real key.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Forbidden: {
          description: 'The key is valid but lacks the required scope. The scope is named in the message.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        RateLimited: {
          description:
            'Limits are per key, not per account, so two integrations do not share a bucket. `details.retryAfterSeconds` says how long to wait.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
      schemas: {
        Brand: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            description: { type: 'string' },
            logo_url: { type: 'string', nullable: true },
            brand_colors: { type: 'array', items: { type: 'string' } },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        Post: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            brand_id: { type: 'string', format: 'uuid' },
            platform: { type: 'string' },
            status: { type: 'string' },
            caption: { type: 'string', nullable: true },
            scheduled_for: { type: 'string', format: 'date-time', nullable: true },
            published_at: { type: 'string', format: 'date-time', nullable: true },
            external_url: {
              type: 'string',
              nullable: true,
              description: 'The post on the platform. Null until it is published.',
            },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        ContentAsset: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            brand_id: { type: 'string', format: 'uuid' },
            product_id: { type: 'string', format: 'uuid', nullable: true },
            type: { type: 'string' },
            url: { type: 'string', nullable: true },
            caption: { type: 'string', nullable: true },
            status: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        Error: {
          type: 'object',
          required: ['error', 'code', 'requestId'],
          properties: {
            error: { type: 'string', description: 'Safe to show a user.' },
            code: { type: 'string' },
            requestId: {
              type: 'string',
              description: 'Quote this in a support request — it appears in our logs for this exact call.',
            },
            details: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
  };
}
