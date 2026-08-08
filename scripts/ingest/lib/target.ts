import { IngestError } from './log'

/**
 * Identifies the database a publish is aimed at, so published-project IDs
 * recorded in the manifest are never reused against a different database.
 *
 * The pipeline is designed to run its first four stages with no database at
 * all, then publish into whichever instance `DATABASE_URI` points at — which
 * makes "run locally, publish to prod" the normal workflow rather than an
 * export/import dance. Project IDs are per-database, so they must be keyed
 * that way.
 *
 * @returns A `host:port/database` key, e.g. `localhost:5432/devsite`.
 */
export function currentTarget(): string {
  const uri = process.env.DATABASE_URI
  if (!uri) {
    throw new IngestError('DATABASE_URI is not set — cannot determine the publish target.')
  }

  try {
    const url = new URL(uri)
    const database = url.pathname.replace(/^\//, '') || 'default'
    return `${url.host}/${database}`
  } catch {
    throw new IngestError(`DATABASE_URI is not a valid connection string: ${uri.slice(0, 24)}...`)
  }
}

/**
 * Target key for a publish made over the REST API instead of a direct database
 * connection. Prefixed so it can never collide with a `currentTarget()` key —
 * publishing to a local database and to the remote instance that fronts a
 * different database must stay two separate records.
 *
 * @param host - Host of the remote instance, e.g. `cms.andribraun.dev`.
 */
export function remoteTarget(host: string): string {
  return `remote:${host}`
}
