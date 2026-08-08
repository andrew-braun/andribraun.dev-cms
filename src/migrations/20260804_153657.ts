import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

import { sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TYPE "public"."enum_projects_status" AS ENUM('live', 'ongoing', 'completed', 'archived');

    CREATE TABLE "projects_contribution_highlights" (
      "_order" integer NOT NULL,
      "_parent_id" integer NOT NULL,
      "id" varchar PRIMARY KEY NOT NULL,
      "statement" varchar NOT NULL
    );

    CREATE TABLE "projects_outcomes" (
      "_order" integer NOT NULL,
      "_parent_id" integer NOT NULL,
      "id" varchar PRIMARY KEY NOT NULL,
      "statement" varchar NOT NULL,
      "metric" varchar
    );

    ALTER TABLE "projects" ADD COLUMN "slug" varchar;
    ALTER TABLE "projects" ADD COLUMN "client_name" varchar;
    ALTER TABLE "projects" ADD COLUMN "status" "enum_projects_status";
    ALTER TABLE "projects" ADD COLUMN "business_challenge" varchar;

    ALTER TABLE "projects_contribution_highlights"
      ADD CONSTRAINT "projects_contribution_highlights_parent_id_fk"
      FOREIGN KEY ("_parent_id") REFERENCES "public"."projects"("id")
      ON DELETE cascade ON UPDATE no action;

    ALTER TABLE "projects_outcomes"
      ADD CONSTRAINT "projects_outcomes_parent_id_fk"
      FOREIGN KEY ("_parent_id") REFERENCES "public"."projects"("id")
      ON DELETE cascade ON UPDATE no action;

    CREATE INDEX "projects_contribution_highlights_order_idx"
      ON "projects_contribution_highlights" USING btree ("_order");
    CREATE INDEX "projects_contribution_highlights_parent_id_idx"
      ON "projects_contribution_highlights" USING btree ("_parent_id");
    CREATE INDEX "projects_outcomes_order_idx"
      ON "projects_outcomes" USING btree ("_order");
    CREATE INDEX "projects_outcomes_parent_id_idx"
      ON "projects_outcomes" USING btree ("_parent_id");
  `)

  // Backfill unique slugs from title before enforcing NOT NULL + unique index.
  await db.execute(sql`
    UPDATE "projects"
    SET "slug" = trim(both '-' from lower(regexp_replace(
      coalesce(nullif(trim("title"), ''), 'project-' || "id"::text),
      '[^a-zA-Z0-9]+',
      '-',
      'g'
    )))
    WHERE "slug" IS NULL OR "slug" = '';
  `)

  await db.execute(sql`
    UPDATE "projects" AS p
    SET "slug" = p."slug" || '-' || p."id"::text
    WHERE EXISTS (
      SELECT 1 FROM "projects" AS o
      WHERE o."slug" = p."slug" AND o."id" < p."id"
    );
  `)

  await db.execute(sql`
    ALTER TABLE "projects" ALTER COLUMN "slug" SET NOT NULL;
    CREATE UNIQUE INDEX "projects_slug_idx" ON "projects" USING btree ("slug");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "projects_contribution_highlights" DISABLE ROW LEVEL SECURITY;
    ALTER TABLE "projects_outcomes" DISABLE ROW LEVEL SECURITY;
    DROP TABLE "projects_contribution_highlights" CASCADE;
    DROP TABLE "projects_outcomes" CASCADE;
    DROP INDEX IF EXISTS "projects_slug_idx";
    ALTER TABLE "projects" DROP COLUMN "slug";
    ALTER TABLE "projects" DROP COLUMN "client_name";
    ALTER TABLE "projects" DROP COLUMN "status";
    ALTER TABLE "projects" DROP COLUMN "business_challenge";
    DROP TYPE "public"."enum_projects_status";
  `)
}
