// Edge Middleware (Vercel): solo los bots/crawlers se enrutan al prerender.
// Los humanos pasan de largo y reciben el SPA estático (index.html) como
// siempre, sin latencia extra ni perder el cache del CDN.
export const config = {
  matcher: [
    "/",
    "/producto/:path*",
    "/reserva/:path*",
    "/plataforma/:path*",
    "/bundles/:path*",
    "/ofertas",
    "/playstation-plus",
    "/game-pass",
    "/reservaciones",
    "/resenas",
    "/faq",
    "/como-comprar",
    "/garantia",
    "/nosotros",
    "/terminos",
    "/privacidad",
  ],
};

const BOT_RE = /facebookexternalhit|facebot|WhatsApp|Twitterbot|Slackbot|Slack-ImgProxy|Discordbot|TelegramBot|LinkedInBot|Pinterest|redditbot|Googlebot|Google-InspectionTool|Storebot-Google|bingbot|DuckDuckBot|Applebot|Embedly|Iframely|vkShare|baiduspider|YandexBot|Quora Link Preview|Skype|Viber|WhatsApp\/|bitlybot|flipboard|tumblr|nuzzel|outbrain|developers\.google\.com\/\+\/web\/snippet/i;

export default function middleware(request) {
  const ua = request.headers.get("user-agent") || "";
  if (!BOT_RE.test(ua)) return; // humano -> continúa al SPA estático

  const url = new URL(request.url);
  const target = new URL("/api/prerender", url.origin);
  target.searchParams.set("path", url.pathname);
  return fetch(target.toString(), { headers: { "user-agent": ua } });
}
