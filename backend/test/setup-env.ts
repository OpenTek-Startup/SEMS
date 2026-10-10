// Safe defaults so tests (and CI) can start the app without a real .env.
// Existing values are never overwritten. The database is mocked in tests.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/yese_test';
process.env.DIRECT_URL ??= 'postgresql://test:test@localhost:5432/yese_test';
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-1234';
