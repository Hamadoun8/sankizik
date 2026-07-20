// SANKIZIK - Cloudflare Function : confirmation de paiement (callback PayDunya)
// PayDunya appelle cette URL quand un paiement aboutit.
// On revalide la facture aupres de PayDunya (on ne fait jamais confiance
// aveuglement a l'appel entrant), puis on passe l'achat en "valide".

export async function onRequestPost({ request, env }) {
  try {
    let token = "";
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const b = await request.json();
      token = (b.data && (b.data.invoice_token || b.data.token)) || b.token || "";
    } else {
      const form = await request.formData();
      token = form.get("data[invoice_token]") || form.get("token") || "";
    }
    if (!token) return new Response("no token", { status: 400 });

    // 1) Reverifier le vrai statut de la facture chez PayDunya
    const base = env.PAYDUNYA_MODE === "live"
      ? "https://app.paydunya.com/api/v1"
      : "https://app.paydunya.com/sandbox-api/v1";
    const pdHead = {
      "PAYDUNYA-MASTER-KEY": env.PAYDUNYA_MASTER_KEY,
      "PAYDUNYA-PRIVATE-KEY": env.PAYDUNYA_PRIVATE_KEY,
      "PAYDUNYA-TOKEN": env.PAYDUNYA_TOKEN
    };
    const rPd = await fetch(`${base}/checkout-invoice/confirm/${token}`, { headers: pdHead });
    const pd = await rPd.json();
    const paye = pd && pd.status === "completed";
    if (!paye) return new Response("not completed", { status: 200 });

    // 2) Marquer l'achat correspondant comme valide
    const SB = env.SUPABASE_URL;
    const SR = env.SUPABASE_SERVICE_KEY;
    const sbHead = { apikey: SR, Authorization: "Bearer " + SR, "Content-Type": "application/json", Prefer: "return=minimal" };
    await fetch(`${SB}/rest/v1/sz_achats?reference=eq.${token}&statut=eq.en_attente`, {
      method: "PATCH",
      headers: sbHead,
      body: JSON.stringify({ statut: "valide", valide_at: new Date().toISOString() })
    });

    return new Response("ok", { status: 200 });
  } catch (e) {
    return new Response("error", { status: 500 });
  }
}
