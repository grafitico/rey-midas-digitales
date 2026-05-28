# Banners del Hero — Especificaciones

Para subir las imágenes del banner rotativo de la portada, usá **estos nombres exactos**:

- `banner-1.jpg`
- `banner-2.jpg`
- `banner-3.jpg`

Si querés más (hasta 5), seguí la numeración (`banner-4.jpg`, `banner-5.jpg`) y avisame para extender el `banners.json`.

---

## Medidas recomendadas

| Tipo | Dimensiones | Aspecto | Peso máximo |
|------|-------------|---------|-------------|
| **Recomendado** | **1920 × 720 px** | 8:3 | < 300 KB |
| Alternativo | 1920 × 600 px | 16:5 | < 250 KB |
| Mínimo aceptable | 1440 × 540 px | 8:3 | < 200 KB |

**Formato:** JPG (preferido) o WebP. Evitá PNG salvo que necesites transparencia.

## Zona segura (importante)

En celular, la imagen se recorta a los lados. Mantené el contenido importante (texto, logo, productos) **centrado en el área 1080 × 720** (el cuadrado del medio). Lo que esté en los bordes izquierdo/derecho puede no verse en móviles.

```
┌─────────────────────────────────────────────────┐
│       │                            │            │
│ Borde │     ZONA SEGURA (centro)   │   Borde    │
│ se    │     Logo, texto, productos │   se       │
│ corta │     1080 × 720             │   corta    │
│       │                            │            │
└─────────────────────────────────────────────────┘
     ←————————— 1920 × 720 —————————————→
```

## Recomendaciones de diseño

- Dejá el texto del banner con buen contraste (texto oscuro sobre fondo claro o viceversa).
- Si vas a poner el título y subtítulo del banner desde la imagen, no hace falta usar los del JSON. Si dejás la imagen "limpia" (solo arte), el sitio le superpone el título/subtítulo + botón CTA del JSON.
- Los textos overlay del JSON (`title`, `subtitle`, `ctaText`) se ven más limpios si el banner tiene una zona oscura o lisa abajo a la izquierda.

## Cómo subir

1. Andá al repo en GitHub: `grafitico/rey-midas-digitales`
2. Entrá a la carpeta `assets/`
3. Click en **Add file → Upload files**
4. Arrastrá los `banner-1.jpg`, `banner-2.jpg`, etc.
5. Commit changes
6. Vercel redespliega solo. En ~1 minuto ya se ven los nuevos banners.

## Cambiar textos / links de los banners

Editá el archivo `banners.json` en la raíz del repo:

```json
{
  "banners": [
    {
      "image": "/assets/banner-1.jpg",
      "title": "Texto grande",
      "subtitle": "Texto más chico debajo",
      "ctaText": "Ver más",
      "ctaHref": "#/ofertas"
    }
  ]
}
```

Si dejás `title` y `subtitle` vacíos (`""`), no se muestra ningún texto encima de la imagen.
