import { isValidISODate } from './dates';

/**
 * Tiny dependency-free form/JSON validation. Every rule returns either a typed
 * value or a human-readable error. Used by server actions and API routes.
 */
export type RuleResult<T> = { ok: true; value: T } | { ok: false; error: string };
export type Rule<T> = (raw: unknown, label: string) => RuleResult<T>;

type Source = FormData | Record<string, unknown>;

function read(src: Source, key: string): unknown {
  if (typeof FormData !== 'undefined' && src instanceof FormData) {
    const v = src.get(key);
    return v === null ? undefined : v;
  }
  return (src as Record<string, unknown>)[key];
}

const isBlank = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

const ok = <T>(value: T): RuleResult<T> => ({ ok: true, value });
const fail = (error: string): RuleResult<never> => ({ ok: false, error });

export type TextOpts = { min?: number; max?: number };

export const rules = {
  text(opts: TextOpts = {}): Rule<string> {
    return (raw, label) => {
      if (isBlank(raw)) return fail(`${label} is required.`);
      if (typeof raw !== 'string') return fail(`${label} must be text.`);
      const v = raw.trim();
      if (opts.min !== undefined && v.length < opts.min) return fail(`${label} needs at least ${opts.min} characters.`);
      if (opts.max !== undefined && v.length > opts.max) return fail(`${label} must be ${opts.max} characters or fewer.`);
      return ok(v);
    };
  },

  optionalText(opts: TextOpts = {}): Rule<string | null> {
    const inner = rules.text(opts);
    return (raw, label) => (isBlank(raw) ? ok(null) : inner(raw, label));
  },

  oneOf<T extends string>(values: readonly T[]): Rule<T> {
    return (raw, label) => {
      if (typeof raw === 'string' && (values as readonly string[]).includes(raw)) return ok(raw as T);
      return fail(`${label} must be one of: ${values.join(', ')}.`);
    };
  },

  optionalOneOf<T extends string>(values: readonly T[]): Rule<T | null> {
    const inner = rules.oneOf(values);
    return (raw, label) => (isBlank(raw) ? ok(null) : inner(raw, label));
  },

  /** Calendar date as YYYY-MM-DD. */
  date(): Rule<string> {
    return (raw, label) => {
      if (isBlank(raw)) return fail(`${label} is required.`);
      if (typeof raw !== 'string' || !isValidISODate(raw.trim())) return fail(`${label} must be a valid date (YYYY-MM-DD).`);
      return ok(raw.trim());
    };
  },

  optionalDate(): Rule<string | null> {
    const inner = rules.date();
    return (raw, label) => (isBlank(raw) ? ok(null) : inner(raw, label));
  },

  /** Accepts a datetime-local string or ISO timestamp and returns an ISO string. */
  optionalDateTime(): Rule<string | null> {
    return (raw, label) => {
      if (isBlank(raw)) return ok(null);
      if (typeof raw !== 'string') return fail(`${label} must be a date and time.`);
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return fail(`${label} must be a valid date and time.`);
      return ok(d.toISOString());
    };
  },

  number(opts: { min?: number; max?: number; int?: boolean } = {}): Rule<number> {
    return (raw, label) => {
      if (isBlank(raw)) return fail(`${label} is required.`);
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, '').trim());
      if (!Number.isFinite(n)) return fail(`${label} must be a number.`);
      if (opts.int && !Number.isInteger(n)) return fail(`${label} must be a whole number.`);
      if (opts.min !== undefined && n < opts.min) return fail(`${label} must be at least ${opts.min}.`);
      if (opts.max !== undefined && n > opts.max) return fail(`${label} must be at most ${opts.max}.`);
      return ok(n);
    };
  },

  optionalNumber(opts: { min?: number; max?: number; int?: boolean } = {}): Rule<number | null> {
    const inner = rules.number(opts);
    return (raw, label) => (isBlank(raw) ? ok(null) : inner(raw, label));
  },

  email(): Rule<string> {
    return (raw, label) => {
      if (isBlank(raw)) return fail(`${label} is required.`);
      if (typeof raw !== 'string') return fail(`${label} must be text.`);
      const v = raw.trim();
      if (v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return fail(`${label} must be a valid email address.`);
      return ok(v.toLowerCase());
    };
  },

  optionalEmail(): Rule<string | null> {
    const inner = rules.email();
    return (raw, label) => (isBlank(raw) ? ok(null) : inner(raw, label));
  },

  uuid(): Rule<string> {
    return (raw, label) => {
      if (typeof raw === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw.trim())) {
        return ok(raw.trim().toLowerCase());
      }
      return fail(`${label} must be a valid id.`);
    };
  },

  optionalUuid(): Rule<string | null> {
    const inner = rules.uuid();
    return (raw, label) => (isBlank(raw) ? ok(null) : inner(raw, label));
  },

  boolean(): Rule<boolean> {
    return (raw) => ok(raw === true || raw === 'true' || raw === 'on' || raw === '1');
  },

  /** JSON string (from a hidden input) validated by a custom check. */
  json<T>(check: (v: unknown) => T | null, fallback: T): Rule<T> {
    return (raw, label) => {
      if (isBlank(raw)) return ok(fallback);
      try {
        const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const checked = check(parsed);
        return checked === null ? fail(`${label} is not in the expected format.`) : ok(checked);
      } catch {
        return fail(`${label} is not in the expected format.`);
      }
    };
  },
};

type Schema = Record<string, Rule<any>>;
type Parsed<S extends Schema> = { [K in keyof S]: S[K] extends Rule<infer T> ? T : never };

export type ParseResult<S extends Schema> =
  | { ok: true; data: Parsed<S> }
  | { ok: false; errors: Record<string, string>; first: string };

const humanize = (key: string) => {
  const s = key.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export function parse<S extends Schema>(src: Source, schema: S, labels: Record<string, string> = {}): ParseResult<S> {
  const errors: Record<string, string> = {};
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(schema)) {
    const res = schema[key](read(src, key), labels[key] ?? humanize(key));
    if (res.ok) data[key] = res.value;
    else errors[key] = res.error;
  }
  const keys = Object.keys(errors);
  if (keys.length > 0) return { ok: false, errors, first: errors[keys[0]] };
  return { ok: true, data: data as Parsed<S> };
}

/** Lines like "Name | Description" -> rows of trimmed cells. Blank lines are skipped. */
export function parsePipeLines(text: string, maxCells: number): string[][] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const cells = l.split('|').map((c) => c.trim());
      if (cells.length > maxCells) {
        const head = cells.slice(0, maxCells - 1);
        head.push(cells.slice(maxCells - 1).join(' | '));
        return head;
      }
      return cells;
    });
}
