import { IngestError } from './log'

export interface ParsedArgs {
  /** `--flag` / `--flag=value` options. */
  flags: Record<string, string | true>
  /** Non-flag arguments, typically slugs. */
  positionals: string[]
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | true> = {}
  const positionals: string[] = []

  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [name, ...rest] = arg.slice(2).split('=')
      flags[name] = rest.length > 0 ? rest.join('=') : true
    } else {
      positionals.push(arg)
    }
  }

  return { flags, positionals }
}

export function flagValue(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name]
  return typeof value === 'string' ? value : undefined
}

export function flagBoolean(args: ParsedArgs, name: string): boolean | undefined {
  const value = args.flags[name]
  if (value === undefined) {
    return undefined
  }
  if (value === true || value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  throw new IngestError(`--${name} must be true or false`)
}

export interface NumberConstraints {
  integer?: boolean
  max?: number
  min?: number
}

export function flagNumber(
  args: ParsedArgs,
  name: string,
  constraints: NumberConstraints = {},
): number | undefined {
  const value = args.flags[name]
  if (value === undefined) {
    return undefined
  }
  if (value === true) {
    throw new IngestError(`--${name} requires a value`)
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new IngestError(`--${name} must be a finite number`)
  }
  if (constraints.integer && !Number.isInteger(parsed)) {
    throw new IngestError(`--${name} must be an integer`)
  }
  if (constraints.min !== undefined && parsed < constraints.min) {
    throw new IngestError(`--${name} must be at least ${constraints.min}`)
  }
  if (constraints.max !== undefined && parsed > constraints.max) {
    throw new IngestError(`--${name} must be at most ${constraints.max}`)
  }
  return parsed
}

export function hasFlag(args: ParsedArgs, name: string): boolean {
  return name in args.flags
}
