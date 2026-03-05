import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

import { sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_projects_display_card_type" AS ENUM('visual', 'text');
  ALTER TABLE "projects" ADD COLUMN "display_featured" boolean;
  ALTER TABLE "projects" ADD COLUMN "display_hide" boolean;
  ALTER TABLE "projects" ADD COLUMN "display_order" numeric;
  ALTER TABLE "projects" ADD COLUMN "display_card_type" "enum_projects_display_card_type" DEFAULT 'visual';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "projects" DROP COLUMN "display_featured";
  ALTER TABLE "projects" DROP COLUMN "display_hide";
  ALTER TABLE "projects" DROP COLUMN "display_order";
  ALTER TABLE "projects" DROP COLUMN "display_card_type";
  DROP TYPE "public"."enum_projects_display_card_type";`)
}
