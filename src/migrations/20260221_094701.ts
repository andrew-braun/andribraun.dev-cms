import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

import { sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "third_party_access_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"created_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "third_party_access" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar DEFAULT 'Default API Key Name' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"enable_a_p_i_key" boolean,
  	"api_key" varchar,
  	"api_key_index" varchar,
  	"email" varchar NOT NULL,
  	"reset_password_token" varchar,
  	"reset_password_expiration" timestamp(3) with time zone,
  	"salt" varchar,
  	"hash" varchar,
  	"login_attempts" numeric DEFAULT 0,
  	"lock_until" timestamp(3) with time zone
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "third_party_access_id" integer;
  ALTER TABLE "payload_preferences_rels" ADD COLUMN "third_party_access_id" integer;
  ALTER TABLE "third_party_access_sessions" ADD CONSTRAINT "third_party_access_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."third_party_access"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "third_party_access_sessions_order_idx" ON "third_party_access_sessions" USING btree ("_order");
  CREATE INDEX "third_party_access_sessions_parent_id_idx" ON "third_party_access_sessions" USING btree ("_parent_id");
  CREATE INDEX "third_party_access_updated_at_idx" ON "third_party_access" USING btree ("updated_at");
  CREATE INDEX "third_party_access_created_at_idx" ON "third_party_access" USING btree ("created_at");
  CREATE UNIQUE INDEX "third_party_access_email_idx" ON "third_party_access" USING btree ("email");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_third_party_access_fk" FOREIGN KEY ("third_party_access_id") REFERENCES "public"."third_party_access"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_third_party_access_fk" FOREIGN KEY ("third_party_access_id") REFERENCES "public"."third_party_access"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_third_party_access_id_idx" ON "payload_locked_documents_rels" USING btree ("third_party_access_id");
  CREATE INDEX "payload_preferences_rels_third_party_access_id_idx" ON "payload_preferences_rels" USING btree ("third_party_access_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "third_party_access_sessions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "third_party_access" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "third_party_access_sessions" CASCADE;
  DROP TABLE "third_party_access" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_third_party_access_fk";
  
  ALTER TABLE "payload_preferences_rels" DROP CONSTRAINT "payload_preferences_rels_third_party_access_fk";
  
  DROP INDEX "payload_locked_documents_rels_third_party_access_id_idx";
  DROP INDEX "payload_preferences_rels_third_party_access_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "third_party_access_id";
  ALTER TABLE "payload_preferences_rels" DROP COLUMN "third_party_access_id";`)
}
