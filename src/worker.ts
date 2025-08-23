import { createBaseApp } from "./app";
import { registerIndexRoutes } from "./routes/indexRoutes";

// Create the base app and register DB-backed routes for full functionality in production
const app = createBaseApp({ includeDbRoutesInDocs: true });
registerIndexRoutes(app);

export default {
  fetch: app.fetch,
};


