// Netlify Function wrapper around the TanStack Start SSR bundle.
// Netlify Functions v2 use the Web Request/Response API natively, which
// matches the shape `dist/server/server.js` already exports.
import server from "../../dist/server/server.js";

export default async (request, context) => {
  return server.fetch(request, {}, context);
};

export const config = {
  // Catch-all: netlify.toml's redirect routes everything that doesn't match a
  // static file in dist/client to this function.
  path: "/*",
  preferStatic: true,
};
