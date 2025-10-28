import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { PrismaLike } from "../../db/types";
import crypto from "crypto";

// Validation schemas
const WaitlistEntrySchema = z.object({
  id: z.string().openapi({ description: "Unique entry ID" }),
  email: z.string().email().openapi({ description: "User email" }),
  consentMarketing: z.boolean().openapi({ description: "Marketing consent" }),
  ipHash: z.string().nullable().openapi({ description: "Hashed IP address" }),
  userAgent: z.string().nullable().openapi({ description: "Browser user agent" }),
  source: z.string().nullable().openapi({ description: "Signup source" }),
  createdAt: z.coerce.date().openapi({ description: "Signup timestamp" }),
  verifiedAt: z.coerce.date().nullable().openapi({ description: "Verification timestamp" }),
}).openapi("WaitlistEntry");

const CreateWaitlistSchema = z.object({
  email: z.string().email("Invalid email address"),
  consentMarketing: z.boolean().optional().default(false),
  source: z.string().optional(),
}).openapi("CreateWaitlist");

const ErrorSchema = z.object({
  message: z.string(),
  error: z.string().optional(),
}).openapi("Error");

const StatsSchema = z.object({
  totalCount: z.number(),
  verifiedCount: z.number(),
  consentCount: z.number(),
  sources: z.record(z.string(), z.number()),
}).openapi("WaitlistStats");

// Helper function to hash IP address
function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

// POST route for joining waitlist
const postRoute = createRoute({
  method: "post",
  path: "/waitlist",
  tags: ["Waitlist"],
  request: { body: { content: { "application/json": { schema: CreateWaitlistSchema } } } },
  responses: {
    201: {
      description: "Successfully added to waitlist",
      content: { "application/json": { schema: WaitlistEntrySchema } },
    },
    400: {
      description: "Invalid input or email already exists",
      content: { "application/json": { schema: ErrorSchema } },
    },
    500: {
      description: "Internal server error",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

// GET route for listing waitlist (admin only)
const getRoute = createRoute({
  method: "get",
  path: "/waitlist",
  tags: ["Waitlist"],
  request: {
    query: z.object({
      limit: z.coerce.number().int().optional().default(100),
      offset: z.coerce.number().int().optional().default(0),
    }),
  },
  responses: {
    200: {
      description: "List of waitlist entries",
      content: { "application/json": { schema: z.array(WaitlistEntrySchema) } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorSchema } },
    },
    500: {
      description: "Internal server error",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

// GET route for stats
const statsRoute = createRoute({
  method: "get",
  path: "/waitlist/stats",
  tags: ["Waitlist"],
  responses: {
    200: {
      description: "Waitlist statistics",
      content: { "application/json": { schema: StatsSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorSchema } },
    },
    500: {
      description: "Internal server error",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

export const waitlist = new OpenAPIHono<{
  Variables: { prisma: PrismaLike };
}>()
  .openapi(postRoute, async (c) => {
    try {
      console.log("[Waitlist POST] Starting handler");
      const prisma = (c.get("prisma") as unknown) as PrismaLike as any;
      console.log("[Waitlist POST] Prisma from context:", !!prisma, typeof prisma);
      
      if (!prisma) {
        console.error("[Waitlist POST] Prisma client is undefined");
        return c.json({ message: "Database connection failed" }, 500);
      }
      
      console.log("[Waitlist POST] Prisma object keys:", Object.keys(prisma || {}));
      console.log("[Waitlist POST] Prisma.waitlist available:", !!prisma.waitlist);
      
      if (!prisma.waitlist) {
        console.error("[Waitlist POST] Waitlist table not available on prisma client");
        return c.json({ message: "Database connection failed" }, 500);
      }
      
      const { email, consentMarketing, source } = c.req.valid("json");

      // Get client IP and user agent
      const ip =
        c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for");
      const userAgent = c.req.header("user-agent");
      const ipHash = hashIp(ip);

      // Check if email already exists
      const existing = await prisma.waitlist.findUnique({
        where: { email },
      });

      if (existing) {
        return c.json(
          { message: "Email already registered on waitlist" },
          400
        );
      }

      // Create new waitlist entry
      const entry = await prisma.waitlist.create({
        data: {
          email,
          consentMarketing,
          ipHash,
          userAgent: userAgent || null,
          source: source || null,
        },
      });

      return c.json(entry, 201);
    } catch (error) {
      console.error("[Waitlist POST] Error:", error);
      return c.json({ message: "Internal server error" }, 500);
    }
  })
  .openapi(getRoute, async (c) => {
    try {
      const adminKey = c.req.header("x-admin-key") || "";
      const env = ((c as any).env as Record<string, string | undefined>) || {};
      const expectedKey =
        env.ADMIN_ACCESS_KEY || process.env.ADMIN_ACCESS_KEY || "";

      if (!expectedKey || adminKey !== expectedKey) {
        return c.json({ message: "Unauthorized" }, 401);
      }

      const prisma = (c.get("prisma") as unknown) as PrismaLike as any;
      
      if (!prisma) {
        console.error("[Waitlist GET] Prisma client is undefined");
        return c.json({ message: "Database connection failed" }, 500);
      }
      
      if (!prisma.waitlist) {
        console.error("[Waitlist GET] Waitlist table not available on prisma client");
        return c.json({ message: "Database connection failed" }, 500);
      }
      
      const { limit, offset } = c.req.valid("query");

      const entries = await prisma.waitlist.findMany({
        take: Math.min(limit, 1000),
        skip: offset,
        orderBy: { createdAt: "desc" },
      });

      return c.json(entries);
    } catch (error) {
      console.error("[Waitlist GET] Error:", error);
      return c.json({ message: "Internal server error" }, 500);
    }
  })
  .openapi(statsRoute, async (c) => {
    try {
      const adminKey = c.req.header("x-admin-key") || "";
      const env = ((c as any).env as Record<string, string | undefined>) || {};
      const expectedKey =
        env.ADMIN_ACCESS_KEY || process.env.ADMIN_ACCESS_KEY || "";

      if (!expectedKey || adminKey !== expectedKey) {
        return c.json({ message: "Unauthorized" }, 401) as any;
      }

      const prisma = (c.get("prisma") as unknown) as PrismaLike as any;
      
      if (!prisma) {
        console.error("[Waitlist Stats] Prisma client is undefined");
        return c.json({ message: "Database connection failed" }, 500) as any;
      }
      
      if (!prisma.waitlist) {
        console.error("[Waitlist Stats] Waitlist table not available on prisma client");
        return c.json({ message: "Database connection failed" }, 500) as any;
      }

      // Get total count
      const totalCount = await prisma.waitlist.count();

      // Get verified count
      const verifiedCount = await prisma.waitlist.count({
        where: { verifiedAt: { not: null } },
      });

      // Get consent count
      const consentCount = await prisma.waitlist.count({
        where: { consentMarketing: true },
      });

      // Get source breakdown
      const sourceData = await prisma.waitlist.groupBy({
        by: ["source"],
        _count: true,
      });

      const sources = sourceData.reduce(
        (acc: Record<string, number>, item: any) => {
          acc[item.source || "direct"] = item._count;
          return acc;
        },
        {}
      );

      return c.json({
        totalCount,
        verifiedCount,
        consentCount,
        sources,
      }) as any;
    } catch (error) {
      console.error("[Waitlist Stats] Error:", error);
      return c.json({ message: "Internal server error" }, 500) as any;
    }
  });
