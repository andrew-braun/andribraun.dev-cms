import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

import { sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "forms" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"form_name" varchar,
  	"form_subject" varchar,
  	"form_body" varchar,
  	"sender_data_name" varchar,
  	"sender_data_email" varchar,
  	"metadata_ip_address" varchar,
  	"metadata_user_agent" varchar,
  	"metadata_referrer" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "forms_id" integer;
  CREATE INDEX "forms_updated_at_idx" ON "forms" USING btree ("updated_at");
  CREATE INDEX "forms_created_at_idx" ON "forms" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_forms_fk" FOREIGN KEY ("forms_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_forms_id_idx" ON "payload_locked_documents_rels" USING btree ("forms_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "forms" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "forms" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_forms_fk";
  
  DROP INDEX "payload_locked_documents_rels_forms_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "forms_id";`)
}
