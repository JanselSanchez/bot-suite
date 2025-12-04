import os
from datetime import datetime
from supabase import create_client, Client
from dotenv import load_dotenv

# Cargar las claves del archivo .env.local
load_dotenv(".env.local")

url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not url or not key:
    print("❌ Error: No se encontraron SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local")
    exit()

try:
    supabase: Client = create_client(url, key)
except Exception as e:
    print(f"❌ Error conectando a Supabase: {e}")
    exit()

# ✅ AQUÍ ESTÁ TU ID REAL (Lo saqué de tus variables: WA_DEFAULT_TENANT_ID)
TENANT_ID = "3870826e-9376-457b-9b53-7533c89e8cda"

def check_vision():
    print(f"🔍 Probando conexión para el Tenant ID: {TENANT_ID}")
    
    print("\n--- 1. PROBANDO CONEXIÓN A BUSINESS HOURS ---")
    # Simulamos la query que hace el bot para ver si hay días abiertos
    try:
        response = supabase.table("business_hours")\
            .select("*")\
            .eq("tenant_id", TENANT_ID)\
            .eq("is_closed", "false")\
            .execute()
        
        hours = response.data
        
        if not hours:
            print("❌ ERROR CRÍTICO: Supabase devuelve lista vacía de horarios.")
            print("   -> Posibles causas:")
            print("      1. RLS está activado (Debes ejecutar el SQL que te di).")
            print("      2. No hay horarios creados para este Tenant ID en la tabla business_hours.")
            print("      3. Todos los horarios tienen is_closed = TRUE.")
        else:
            print(f"✅ ÉXITO: Se encontraron {len(hours)} días de apertura configurados.")
            for h in hours:
                print(f"   - Día {h.get('dow')}: {h.get('open_time')} - {h.get('close_time')}")

    except Exception as e:
        print(f"❌ Excepción consultando Business Hours: {e}")

    print("\n--- 2. PROBANDO SI VEMOS LAS CITAS ---")
    try:
        # Ver si ve las citas existentes desde hoy
        today = datetime.now().isoformat()
        resp_bookings = supabase.table("bookings")\
            .select("id, starts_at, customer_phone")\
            .eq("tenant_id", TENANT_ID)\
            .gte("starts_at", today)\
            .execute()
        
        print(f"ℹ️ El sistema ve {len(resp_bookings.data)} citas futuras bloqueando espacios.")
        if len(resp_bookings.data) > 0:
            print(f"   Ejemplo de cita encontrada: {resp_bookings.data[0]}")
    except Exception as e:
        print(f"❌ Excepción consultando Bookings: {e}")

if __name__ == "__main__":
    check_vision()