import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

import { sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "projects" ADD COLUMN "intro_markdown" varchar;
  ALTER TABLE "projects" ADD COLUMN "tech_stack_markdown" varchar;
  ALTER TABLE "projects" ADD COLUMN "implementation_markdown" varchar;
  ALTER TABLE "projects" ADD COLUMN "outcome_markdown" varchar;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "projects" DROP COLUMN "intro_markdown";
  ALTER TABLE "projects" DROP COLUMN "tech_stack_markdown";
  ALTER TABLE "projects" DROP COLUMN "implementation_markdown";
  ALTER TABLE "projects" DROP COLUMN "outcome_markdown";`)
}
