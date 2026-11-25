<?php
// /sitemap.xml (ver .htaccess): la tienda y una página por diseño (/d/<id>).
$base = 'https://searcade.reymidascr.com';
$json = @file_get_contents(__DIR__ . '/artes/artes.json');
$indice = $json ? json_decode($json, true) : null;
header('Content-Type: application/xml; charset=utf-8');
header('Cache-Control: public, max-age=3600');
echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
echo "  <url><loc>$base/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n";
foreach (($indice['artes'] ?? []) as $a) {
  $id = (string) ($a['id'] ?? '');
  if (!preg_match('/^[A-Za-z0-9_-]{1,40}$/', $id)) continue;
  $fecha = substr((string) ($a['creado'] ?? ''), 0, 10);
  echo "  <url><loc>$base/d/" . rawurlencode($id) . '</loc>' . (preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha) ? "<lastmod>$fecha</lastmod>" : '') . "</url>\n";
}
echo "</urlset>\n";
