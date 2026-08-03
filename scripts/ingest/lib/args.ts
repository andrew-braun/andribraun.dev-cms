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

export function flagNumber(args: ParsedArgs, name: string): number | undefined {
  const value = flagValue(args, name)
  if (value === undefined) {
    return undefined
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function hasFlag(args: ParsedArgs, name: string): boolean {
  return name in args.flags
}
