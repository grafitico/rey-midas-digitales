export default function handler(req, res) {
  const txt = `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /mi-cuenta\nSitemap: https://reymidascr.com/sitemap.xml\n`;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.status(200).send(txt);
}
