// Typed view of the environment. Values are already checked by
// env.validation.ts before this runs, so missing values fail at startup.
export default () => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  database: {
    url: process.env.DATABASE_URL,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    // Access token lifetime: 15m, 900 (seconds), 1h ...
    expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
  },
  session: {
    // Idle timeout (SRS FR-ID: end an idle session after 15 minutes).
    idleMinutes: parseInt(process.env.SESSION_IDLE_MINUTES ?? '15', 10),
    // Absolute session length, whatever the activity.
    maxHours: parseInt(process.env.SESSION_MAX_HOURS ?? '12', 10),
  },
});
