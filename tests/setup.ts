process.env.DATABASE_PATH = ":memory:";
process.env.DEMO_MODE = "true";
(process.env as Record<string, string>).NODE_ENV = "test";
delete process.env.PAYPAL_CLIENT_ID;
delete process.env.PAYPAL_CLIENT_SECRET;
delete process.env.PAYPAL_WEBHOOK_ID;
delete process.env.ANTHROPIC_API_KEY;
