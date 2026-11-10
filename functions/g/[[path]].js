// /g/<code>/ : every client gallery uses the same page (g/index.html); its script reads the code from the address.
// /g/ itself (the "enter your gallery code" page) and real files such as /g/sw.js are served as normal.
import { noindex } from "../../_functions_lib/delivery.js";

export async function onRequest({ request, params, env, next }) {
  const parts = params.path || [];
  if (!parts.length || parts.some((p) => p.includes("."))) return next();

  const url = new URL(request.url);
  const wanted = `/g/${parts[0]}/`;
  if (url.pathname !== wanted) return Response.redirect(`${url.origin}${wanted}${url.search}`, 301);

  const page = await env.ASSETS.fetch(new URL("/g/", url));
  const res = new Response(page.body, page);
  noindex(res.headers);
  return res;
}
