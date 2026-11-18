/**
 * Parse a boolean the way an env-var flag is usually written: `1`, `true`,
 * `yes`, `on` and `0`, `false`, `no`, `off`, ignoring case and surrounding
 * whitespace. Anything else is `undefined`.
 */
function parseBool(raw: string): boolean | undefined {
  switch (raw.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true;
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return false;
    default:
      return undefined;
  }
}

/**
 * A flag default read from an environment variable, for a service moving from
 * env-var flags: "when Savvagent Flags cannot be reached, use what the
 * variable says". Pass it in `defaultsFrom`; the variable is read once, when
 * the client is built.
 *
 * Accepted values, ignoring case and surrounding whitespace, are `1`, `true`,
 * `yes`, `on` and `0`, `false`, `no`, `off`. An unset variable is ignored
 * silently (in production it is the normal case); one that is empty or says
 * anything else is ignored with a warning that names the variable but not its
 * value. Either way `defaults[key]`, or the built-in `false`, stays in place.
 *
 * @param name - The environment variable to read.
 * @param env - Where to read it from (default: `process.env`).
 *
 * @example
 * ```ts
 * const client = new FlagClient({
 *   apiKey: process.env.SAVVAGENT_FLAGS_API_KEY!,
 *   defaultsFrom: { 'new-checkout': defaultFromEnv('NEW_CHECKOUT') },
 * });
 * ```
 */
export function defaultFromEnv(
  name: string,
  env: Record<string, string | undefined> = process.env
): () => boolean | undefined {
  return () => {
    if (!Object.prototype.hasOwnProperty.call(env, name)) return undefined;
    const raw = env[name];
    if (raw === undefined) return undefined;
    const parsed = parseBool(raw);
    if (parsed === undefined) {
      console.warn(
        `Savvagent Flags: environment variable ${JSON.stringify(name)} is not a boolean; ignoring it`
      );
    }
    return parsed;
  };
}

/**
 * `defaults` with every `defaultsFrom` function applied (each called once).
 * Returns a new record; neither argument is modified.
 */
export function resolveDefaults(
  defaults: Readonly<Record<string, boolean>>,
  defaultsFrom: Readonly<Record<string, () => boolean | undefined>>
): Record<string, boolean> {
  const resolved: Record<string, boolean> = Object.create(null);
  for (const key of Object.keys(defaults)) resolved[key] = defaults[key];
  for (const key of Object.keys(defaultsFrom)) {
    const value = defaultsFrom[key]();
    if (typeof value === 'boolean') resolved[key] = value;
  }
  return resolved;
}
