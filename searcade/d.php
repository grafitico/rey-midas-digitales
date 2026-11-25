<?php
// SEARCADE — página para compartir UN diseño: /d/<id> (ver .htaccess).
// WhatsApp, Facebook e Instagram leen estas etiquetas y muestran la foto y el
// nombre de ESE diseño; las personas pasan directo a la tienda en /#<id>.
// Lee artes/artes.json (lo escribe api/searcade.js desde el panel).

$id = isset($_GET['id']) ? (string) $_GET['id'] : '';
$base = 'https://searcade.reymidascr.com';
if (!preg_match('/^[A-Za-z0-9_-]{1,40}$/', $id)) { header('Location: ' . $base . '/', true, 302); exit; }

$arte = null;
$json = @file_get_contents(__DIR__ . '/artes/artes.json');
$indice = $json ? json_decode($json, true) : null;
foreach (($indice['artes'] ?? []) as $a) { if (($a['id'] ?? '') === $id) { $arte = $a; break; } }
$tienda = $base . '/#' . rawurlencode($id);
if (!$arte) { header('Location: ' . $tienda, true, 302); exit; }

$h = function ($s) { return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8'); };
$nombre = trim((string) ($arte['nombre'] ?? 'Camiseta SEARCADE'));
$precio = (int) ($arte['precio'] ?? 0) ?: 11000; // mismo precio base que config.js (precioBase)
$tipo = !empty($arte['semitono']) ? 'DTF semitono' : 'DTF full color';
$desc = trim((string) ($arte['descripcion'] ?? '')) ?: "Camiseta SEARCADE con estampado $tipo. Elegí color, tamaño y espalda. Envíos a todo Costa Rica.";
$img = $base . '/' . ltrim((string) ($arte['archivo'] ?? ''), '/');
// Si hay una foto con modelo de este diseño (Lookbook ligado), esa vende más.
foreach (($indice['lookbook'] ?? []) as $f) {
  if (($f['arte'] ?? '') === $id && !empty($f['archivo'])) { $img = $base . '/' . ltrim((string) $f['archivo'], '/'); break; }
}
$url = $base . '/d/' . rawurlencode($id);
$monto = '₡' . number_format($precio, 0, ',', '.');
$ld = [
  '@context' => 'https://schema.org', '@type' => 'Product', 'name' => $nombre, 'image' => [$img],
  'description' => $desc, 'sku' => $id, 'brand' => ['@type' => 'Brand', 'name' => 'SEARCADE'],
  'offers' => ['@type' => 'Offer', 'url' => $url, 'priceCurrency' => 'CRC', 'price' => $precio, 'availability' => 'https://schema.org/InStock'],
];
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: public, max-age=600');
?><!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><?= $h($nombre) ?> — Camiseta SEARCADE</title>
  <meta name="description" content="<?= $h($desc) ?>">
  <link rel="canonical" href="<?= $h($url) ?>">
  <meta property="og:site_name" content="SEARCADE">
  <meta property="og:type" content="product">
  <meta property="og:url" content="<?= $h($url) ?>">
  <meta property="og:title" content="<?= $h($nombre) ?> · <?= $h($monto) ?> — SEARCADE">
  <meta property="og:description" content="<?= $h($desc) ?>">
  <meta property="og:image" content="<?= $h($img) ?>">
  <meta property="og:locale" content="es_CR">
  <meta property="product:price:amount" content="<?= $precio ?>">
  <meta property="product:price:currency" content="CRC">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#0a0414">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <script type="application/ld+json"><?= json_encode($ld, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG) ?></script>
  <script>location.replace(<?= json_encode($tienda, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG) ?>);</script>
  <style>body{margin:0;min-height:100vh;display:grid;place-content:center;gap:14px;padding:24px;background:#0a0414;color:#fff;font-family:system-ui,sans-serif;text-align:center}img{max-width:min(80vw,360px)}a{color:#19e6ff;font-weight:700}</style>
</head>
<body>
  <img src="<?= $h($img) ?>" alt="<?= $h($nombre) ?>">
  <h1><?= $h($nombre) ?></h1>
  <p><?= $h($tipo) ?> · desde <?= $h($monto) ?></p>
  <p><a href="<?= $h($tienda) ?>">Ver en la tienda SEARCADE</a></p>
</body>
</html>
