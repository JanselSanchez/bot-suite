import os
from supabase import create_client, Client
from dotenv import load_dotenv

# Carga variables de entorno (Asegúrate de tener .env con SUPABASE_URL y SERVICE_ROLE_KEY)
load_dotenv(".env.local") 

url: str = os.environ.get("SUPABASE_URL")
# IMPORTANTE: Usa la SERVICE_ROLE_KEY para poder editar todo sin restricciones
key: str = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") 

if not url or not key:
    print("❌ Faltan credenciales en el .env")
    exit()

supabase: Client = create_client(url, key)

def clean_phone(phone_str):
    if not phone_str: return None
    # Elimina 'whatsapp:', símbolos '+' y espacios. Deja solo números.
    clean = ''.join(filter(str.isdigit, str(phone_str)))
    return clean

def run_fix():
    print("🔄 Descargando bookings...")
    # Traemos todas las citas
    response = supabase.table("bookings").select("id, customer_phone").execute()
    bookings = response.data

    count = 0
    for b in bookings:
        original = b.get("customer_phone", "")
        if not original: continue

        cleaned = clean_phone(original)

        # Si el número estaba sucio (tenía letras o símbolos), lo actualizamos
        if original != cleaned:
            print(f"🛠️ Corrigiendo ID {b['id']}: {original} -> {cleaned}")
            supabase.table("bookings").update({"customer_phone": cleaned}).eq("id", b['id']).execute()
            count += 1
    
    print(f"✅ Proceso terminado. Se corrigieron {count} números de teléfono.")

if __name__ == "__main__":
    run_fix()