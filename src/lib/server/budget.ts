import 'server-only';

// The logic lives in src/lib/budget.ts so tests can import it; server code imports it through here.
export * from '../budget';
