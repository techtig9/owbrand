/**
 * Deterministic environment for the Phase 1 suite.
 *
 * These are syntactically valid but non-functional placeholders: the tests
 * exercise our own authorization, validation and idempotency logic, never a
 * live Supabase/Paddle/Resend account. Anything that would make a real network
 * call is mocked at the module boundary inside the individual test files.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://test-project.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
process.env.NEXT_PUBLIC_SITE_URL ??= 'https://owbrand.test';
// NODE_ENV is set by Vitest itself and is read-only under @types/node.
