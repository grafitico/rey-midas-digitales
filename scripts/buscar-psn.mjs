// Busca productos en la PS Store (es-cr) con el mismo buscador GraphQL que usan
// los robots y muestra id | título | plataforma | precio | tipo. Sirve para
// encontrar el psnId de un destacado que no se empareja solo:
//   node scripts/buscar-psn.mjs "Ratchet & Clank" "Jedi Fallen Order"
import { fetchSearchProducts } from "../api/scrape.js";

for (const q of process.argv.slice(2)) {
  try {
    const r = await fetchSearchProducts(q, null, { maxItems: 24 });
    console.log(`\n## ${q} → ${r.length} resultados`);
    for (const g of r.slice(0, 12)) console.log(`   ${g.id} | ${g.title} | ${g.platform} | $${g.priceUSD} | ${g.type}`);
  } catch (e) {
    console.log(`\n## ${q} → ERROR ${e.message}`);
  }
  await new Promise(r => setTimeout(r, 300));
}
