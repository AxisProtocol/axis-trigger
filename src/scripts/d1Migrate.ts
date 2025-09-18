import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// Generate SQL diffs from Prisma schema and apply via Wrangler migrations.
// Notes:
// - First run (no prior migrations): generates 0001 from-empty
// - Subsequent runs: diffs previous committed schema (HEAD) -> current prisma/schema.prisma
// - Avoids re-creating tables and fixes the hard-coded 0001_ prefix issue

function sh(cmd: string): void {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function shCapture(cmd: string): string {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });
}

function zeroPad(num: number, width = 4): string {
  const s = String(num);
  return s.length >= width ? s : "0".repeat(width - s.length) + s;
}

function getNextMigrationIndex(migrationsDir: string): number {
  if (!existsSync(migrationsDir)) return 1;
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  const indices = files
    .map((f) => {
      const match = /^([0-9]{4})_/.exec(f);
      return match ? Number(match[1]) : undefined;
    })
    .filter((n): n is number => typeof n === "number");
  if (indices.length === 0) return 1;
  return Math.max(...indices) + 1;
}

function resolveMigrationName(args: string[]): { name: string; apply: boolean } {
  let apply = true;
  const nonFlags = args.filter((a) => !a.startsWith("-"));
  const name = nonFlags[0] || `auto_${Date.now()}`;
  if (args.includes("--no-apply")) apply = false;
  return { name, apply };
}

function main(): void {
  const migrationsDir = "migrations";
  const dbName = process.env.D1_NAME || "axis_trigger";
  const { name: migrationName, apply } = resolveMigrationName(process.argv.slice(2));

  // Ensure directories
  if (!existsSync(migrationsDir)) mkdirSync(migrationsDir, { recursive: true });
  const stateDir = ".prisma-state";
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });

  // Decide target filename
  const nextIdx = getNextMigrationIndex(migrationsDir);
  const target = join(migrationsDir, `${zeroPad(nextIdx)}_${migrationName}.sql`);

  // Try to use previously committed schema as "from" to produce a real diff
  const prismaSchema = "./prisma/schema.prisma";
  const prevSchemaPath = join(stateDir, "prev.prisma");

  let useFromEmpty = false;
  try {
    // If repository has a committed schema, diff from HEAD to current
    const prev = shCapture(`git show HEAD:${prismaSchema} 2> /dev/null || true`);
    if (prev && prev.trim().length > 0) {
      writeFileSync(prevSchemaPath, prev, "utf8");
    } else {
      // No committed schema found (first commit or file untracked)
      useFromEmpty = true;
    }
  } catch {
    useFromEmpty = true;
  }

  // If this is not the first migration (files exist) but we couldn't read HEAD,
  // avoid from-empty which would recreate tables. In that case, attempt a no-op by
  // setting prevSchema to current schema to only capture future changes.
  if (!useFromEmpty && !existsSync(prevSchemaPath)) {
    useFromEmpty = true;
  }
  if (!existsSync(prevSchemaPath) && existsSync(migrationsDir) && readdirSync(migrationsDir).some((f) => /^([0-9]{4})_/.test(f))) {
    // There are existing migrations but no prev schema to diff from
    // Fallback: snapshot current schema for future diffs and exit early with a helpful message
    const current = readFileSync(prismaSchema, "utf8");
    writeFileSync(prevSchemaPath, current, "utf8");
    console.log("No previous committed schema found. Snapshotted current schema for future diffs. Nothing to do.");
    return;
  }

  // Build diff command
  const baseCmd = [
    "pnpm dlx prisma migrate diff",
    useFromEmpty ? "--from-empty" : `--from-schema-datamodel ${prevSchemaPath}`,
    `--to-schema-datamodel ${prismaSchema}`,
    "--script",
    `--output ${target}`,
  ].join(" ");

  // Generate SQL
  sh(baseCmd);

  // If no changes, delete file and exit
  try {
    const content = readFileSync(target, "utf8").trim();
    if (content.length === 0 || /no\s+changes/i.test(content)) {
      try { sh(`rm -f ${target}`); } catch {}
      console.log("No schema changes detected. Skipped migration creation.");
      return;
    }
  } catch {}

  if (!apply) {
    console.log(`Migration generated at ${target}. Skipping apply due to --no-apply.`);
    return;
  }

  // Apply locally and remotely (non-interactive): pipe a single "yes" to confirm
  sh(`printf "yes\n" | pnpm dlx wrangler d1 migrations apply ${dbName} --local`);
  sh(`printf "yes\n" | pnpm dlx wrangler d1 migrations apply ${dbName} --remote`);

  // Update prev schema snapshot to current for next run
  try {
    const current = readFileSync(prismaSchema, "utf8");
    writeFileSync(prevSchemaPath, current, "utf8");
  } catch {}

  console.log(`Migration generated at ${target} and applied to D1 (${dbName}).`);
}

main();


