"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import TemplateEditor from "@/componentes/templates/Editor";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type TemplateValue = any; // si tu Editor exporta un tipo, úsalo aquí

export default function BotEditorPage() {
  const router = useRouter();

  const [tenantId, setTenantId] = useState<string>("");
  const [value, setValue] = useState<TemplateValue>({
    name: "Mi bot",
    flows: {},
    features: {},
    branding: {},
  });

  useEffect(() => {
    (async () => {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;

      const { data: tu } = await sb
        .from("tenant_users")
        .select("tenant_id")
        .eq("user_id", user.id)
        .order("role", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (tu?.tenant_id) {
        setTenantId(tu.tenant_id);

        // (Opcional) aquí podrías cargar el template real desde tu BD si ya lo tienes.
        // const { data } = await sb.from("bot_templates").select("value").eq("tenant_id", tu.tenant_id).maybeSingle();
        // if (data?.value) setValue(data.value);
      }
    })();
  }, []);

  const handleClose = () => {
    router.push("/dashboard"); // o router.back();
  };

  const handleSaved = async (next: TemplateValue) => {
    setValue(next);
    // (Opcional) persiste en BD si ya tienes tabla/endpoint:
    // await sb.from("bot_templates")
    //   .upsert({ tenant_id: tenantId, value: next }, { onConflict: "tenant_id" });
  };

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Editor del Bot</h1>
        <p className="text-sm text-gray-500">
          Ajusta mensajes, respuestas y estructura sin tocar código.
        </p>
      </header>

      {/* El Editor exige estas 3 props: value, onClose, onSaved */}
      <TemplateEditor
        value={value}
        onClose={handleClose}
        onSaved={handleSaved}
        // tenantId={tenantId} // pásalo si tu Editor lo admite
      />
    </div>
  );
}
