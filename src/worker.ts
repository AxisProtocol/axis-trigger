import { createBaseApp } from "./app";

const app = createBaseApp({ includeDbRoutesInDocs: false });

export default {
  fetch: app.fetch,
};


