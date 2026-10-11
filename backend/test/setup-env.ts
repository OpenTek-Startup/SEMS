// Safe defaults so tests (and CI) can start the app without a real .env.
// Existing values are never overwritten. The database is mocked in tests.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/yese_test';
process.env.DIRECT_URL ??= 'postgresql://test:test@localhost:5432/yese_test';
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-1234';
// Auth timings the e2e tests rely on. Set before ConfigModule reads .env,
// so a different value in your local .env does not break the tests.
process.env.JWT_EXPIRES_IN ??= '15m';
process.env.SESSION_IDLE_MINUTES ??= '15';
process.env.SESSION_MAX_HOURS ??= '12';
