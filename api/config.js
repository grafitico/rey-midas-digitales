// Devuelve la configuración pública de Supabase para que el frontend
// inicialice el cliente sin tener las claves hardcodeadas en el JS.
// Las dos variables (NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY)
// las configura automáticamente la integración de Supabase en Vercel.

export default function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");
  res.status(200).json({
    supabase: {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "",
      anonKey:
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
        process.env.SUPABASE_ANON_KEY ||
        "",
    },
  });
}
