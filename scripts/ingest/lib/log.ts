const DIM = '\u001b[2m'
const RED = '\u001b[31m'
const YELLOW = '\u001b[33m'
const GREEN = '\u001b[32m'
const BOLD = '\u001b[1m'
const RESET = '\u001b[0m'

export const log = {
  /** Section header, printed once per stage. */
  banner(message: string): void {
    console.log(`\n${BOLD}${message}${RESET}`)
  },
  detail(message: string): void {
    console.log(`${DIM}  ${message}${RESET}`)
  },
  error(message: string): void {
    console.error(`${RED}✗ ${message}${RESET}`)
  },
  info(message: string): void {
    console.log(`  ${message}`)
  },
  ok(message: string): void {
    console.log(`${GREEN}✓${RESET} ${message}`)
  },
  step(message: string): void {
    console.log(`\n${BOLD}▸ ${message}${RESET}`)
  },
  warn(message: string): void {
    console.warn(`${YELLOW}! ${message}${RESET}`)
  },
}

export class IngestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IngestError'
  }
}
