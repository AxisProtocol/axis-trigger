import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Generate SQL from Prisma schema and apply via Wrangler migrations.
// References:
// - Cloudflare D1 + Prisma tutorial: https://developers.cloudflare.com/d1/tutorials/d1-and-prisma-orm/

function sh(cmd: string): void {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function main(): void {
  const migrationsDir = "migrations";
  const dbName = process.env.D1_NAME || "axis_trigger";
  const migrationName = process.argv[2] || `auto_${Date.now()}`;
  const target = `${migrationsDir}/0001_${migrationName}.sql`;

  // Ensure migrations dir exists (wrangler will create it on first create, but we ensure it here)
  try { sh(`mkdir -p ${migrationsDir}`); } catch {}

  // Diff from empty to current schema to generate full SQL
  sh(`pnpm dlx prisma migrate diff --from-empty --to-schema-datamodel ./prisma/schema.prisma --script --output ${target}`);

  // Apply locally and remotely
  sh(`pnpm dlx wrangler d1 migrations apply ${dbName} --local`);
  sh(`pnpm dlx wrangler d1 migrations apply ${dbName} --remote`);

  console.log(`Migration generated at ${target} and applied to D1 (${dbName}).`);
}

main();


