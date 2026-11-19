// Postavke stranice. Ovi podaci su javni i smiju biti u kodu:
// podatke štite sigurnosna pravila u bazi (supabase/schema.sql).
// NIKADA ovdje ne upisuj "secret" ili "service_role" ključ.
window.BISSTAGE = {
  supabaseUrl: "https://livgzretoteimhcwocvk.supabase.co",
  supabaseKey: "sb_publishable_NyRP3eh3NfSww1sM0yYh5w_ILarcC21",
  // Prebaci na true kad u Supabaseu uključiš Google prijavu.
  googlePrijava: true,
  // Javni "site key" Cloudflare Turnstile widgeta (zaštita od botova). Prazno = isključeno.
  // Tajni ključ ide samo u Supabase (Authentication -> Attack Protection), nikad ovdje.
  turnstileKljuc: "",
};
