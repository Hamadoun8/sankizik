// SANKIZIK - Cloudflare Function : creation d'un paiement PayDunya
// Recoit { produit_id, user_id } depuis le site.
// Verifie le prix cote serveur, cree une facture PayDunya, enregistre
// l'achat en attente avec le token, et renvoie l'URL de paiement.
// Les cles PayDunya et Supabase ne quittent JAMAIS le serveur.

export async function onRequestPost({ request, env }) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  try {
    const { produit_id, user_id } = await request.json();
    if (!produit_id || !user_id) {
      return new Response(JSON.stringify({ error: "Requete incomplete." }), { status: 400, headers: cors });
    }

    const SB = env.SUPABASE_URL;
    const SR = env.SUPABASE_SERVICE_KEY;   // cle service (secrete)
    const sbHead = { apikey: SR, Authorization: "Bearer " + SR, "Content-Type": "application/json" };

    // 1) Prix reel de l'oeuvre, lu cote serveur (le client ne peut pas le falsifier)
    const rProd = await fetch(`${SB}/rest/v1/sz_produits?id=eq.${produit_id}&select=id,titre,nom_artiste,prix_fcfa,en_ligne`, { headers: sbHead });
    const prods = await rProd.json();
    const p = prods && prods[0];
    if (!p) return new Response(JSON.stringify({ error: "Oeuvre introuvable." }), { status: 404, headers: cors });

    // 2) Refuser si l'oeuvre est deja achetee (achat actif)
    const rDeja = await fetch(`${SB}/rest/v1/sz_achats?user_id=eq.${user_id}&produit_id=eq.${produit_id}&statut=in.(en_attente,valide)&select=id`, { headers: sbHead });
    const deja = await rDeja.json();
    if (Array.isArray(deja) && deja.length) {
      return new Response(JSON.stringify({ error: "Vous avez deja un achat en cours ou valide pour cette oeuvre." }), { status: 409, headers: cors });
    }

    // 3) Creer la facture PayDunya
    const pdHead = {
      "Content-Type": "application/json",
      "PAYDUNYA-MASTER-KEY": env.PAYDUNYA_MASTER_KEY,
      "PAYDUNYA-PRIVATE-KEY": env.PAYDUNYA_PRIVATE_KEY,
      "PAYDUNYA-TOKEN": env.PAYDUNYA_TOKEN
    };
    const base = env.PAYDUNYA_MODE === "live"
      ? "https://app.paydunya.com/api/v1"
      : "https://app.paydunya.com/sandbox-api/v1";

    const origin = new URL(request.url).origin;
    const facture = {
      invoice: {
        total_amount: p.prix_fcfa,
        description: `Achat SankiZik : ${p.titre} - ${p.nom_artiste}`
      },
      store: { name: env.SANKIZIK_NOM || "SankiZik" },
      custom_data: { user_id, produit_id },
      actions: {
        return_url: `${origin}/#/bibliotheque`,
        cancel_url: `${origin}/#/produit/${produit_id}`,
        callback_url: `${origin}/api/paydunya-callback`
      }
    };

    const rPd = await fetch(`${base}/checkout-invoice/create`, {
      method: "POST", headers: pdHead, body: JSON.stringify(facture)
    });
    const pd = await rPd.json();
    if (pd.response_code !== "00" || !pd.token) {
      return new Response(JSON.stringify({ error: "Paiement indisponible pour le moment. Reessayez." }), { status: 502, headers: cors });
    }

    // 4) Enregistrer l'achat en attente, avec le token PayDunya
    await fetch(`${SB}/rest/v1/sz_achats`, {
      method: "POST",
      headers: { ...sbHead, Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id, produit_id, montant_fcfa: p.prix_fcfa,
        moyen: "paydunya", reference: pd.token, statut: "en_attente"
      })
    });

    return new Response(JSON.stringify({ url: pd.response_text }), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Erreur serveur." }), { status: 500, headers: cors });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  }});
}
