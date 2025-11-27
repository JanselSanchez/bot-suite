// app/dashboard/status/page.tsx
export const dynamic = "force-dynamic"; // evita cacheo estático

type StatusResp =
  | { kind: "queues"; data: any }
  | { kind: "health"; data: any }
  | { kind: "none"; data: null; error: string };

async function getStatus(): Promise<StatusResp> {
  // 1) intenta /api/health
  try {
    const r = await fetch("/api/health", { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      if (j && typeof j === "object" && "queues" in j) {
        return { kind: "queues", data: j };
      }
      return { kind: "health", data: j };
    }
  } catch {
    // ignore
  }

  // 2) fallback: /api/admin/status (por si existe)
  try {
    const r2 = await fetch("/api/admin/status", { cache: "no-store" });
    if (r2.ok) {
      const j2 = await r2.json();
      const kind: "queues" | "health" = "queues" in j2 ? "queues" : "health";
      return { kind, data: j2 };
    }
  } catch {
    // ignore
  }

  return {
    kind: "none",
    data: null,
    error: "No se pudo contactar /api/health ni /api/admin/status",
  };
}

export default async function StatusPage() {
  const resp = await getStatus();

  // normaliza banderas de OK
  let envOk = {
    NEXT_PUBLIC_SUPABASE_URL: false,
    SUPABASE_SERVICE_ROLE_KEY: false,
    REDIS_URL: false,
    OPENAI_API_KEY: false,
    WA_DEFAULT_TENANT_ID: false,
  };
  let servicesOk = {
    supabase: undefined as boolean | undefined,
    redis: undefined as boolean | undefined,
    wa_server: undefined as boolean | undefined,
    wa_default_tenant: undefined as boolean | undefined,
    worker_heartbeat: undefined as boolean | undefined,
  };

  let queues: Record<string, any> | null = null;
  let globalOk = false;
  let errorMsg: string | null = null;

  if (resp.kind === "health") {
    const d: any = resp.data;
    envOk = {
      NEXT_PUBLIC_SUPABASE_URL: Boolean(d?.env?.NEXT_PUBLIC_SUPABASE_URL),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(d?.env?.SUPABASE_SERVICE_ROLE_KEY),
      REDIS_URL: Boolean(d?.env?.REDIS_URL),
      OPENAI_API_KEY: Boolean(d?.env?.OPENAI_API_KEY),
      WA_DEFAULT_TENANT_ID: Boolean(d?.env?.WA_DEFAULT_TENANT_ID),
    };
    servicesOk = {
      supabase: Boolean(d?.services?.supabase?.ok ?? d?.services?.supabase),
      redis: Boolean(d?.services?.redis?.ok ?? d?.services?.redis),
      // soporta tanto services.wa.server como services.wa_server
      wa_server: Boolean(
        d?.services?.wa?.server ?? d?.services?.wa_server ?? d?.services?.whatsapp?.server,
      ),
      wa_default_tenant: Boolean(
        d?.services?.wa?.default_tenant ??
          d?.services?.wa_default_tenant ??
          d?.services?.whatsapp?.default_tenant,
      ),
      worker_heartbeat: Boolean(d?.services?.worker?.heartbeat),
    };
    globalOk =
      Boolean(d?.ok) ||
      Object.values(servicesOk).some((v) => v === true);
  } else if (resp.kind === "queues") {
    const d: any = resp.data;
    // En este formato, “up” significa OK. No hay envs aquí → quedan “—”.
    servicesOk = {
      supabase: undefined,
      redis: undefined,
      wa_server: undefined,
      wa_default_tenant: undefined,
      worker_heartbeat:
        d?.bot === "up" ||
        d?.notifications === "up" ||
        d?.outbox === "up" ||
        d?.reminders === "up" ||
        d?.noshow === "up",
    };
    queues = d?.queues ?? null;
    globalOk =
      d?.bot === "up" ||
      d?.notifications === "up" ||
      d?.outbox === "up" ||
      d?.reminders === "up" ||
      d?.noshow === "up";
  } else {
    errorMsg = resp.error ?? "Sin datos";
  }

  const Badge = ({ ok }: { ok: boolean }) => (
    <span
      className={`px-2 py-1 text-xs rounded-full ${
        ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
      }`}
    >
      {ok ? "Operativo" : "Con problemas"}
    </span>
  );

  const Item = ({
    label,
    value,
  }: {
    label: string;
    value: boolean | undefined;
  }) => (
    <div className="flex items-center justify-between py-2 border-b last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={`text-sm font-medium ${
          value === true
            ? "text-green-600"
            : value === false
            ? "text-red-600"
            : "text-foreground"
        }`}
      >
        {value === true ? "OK" : value === false ? "ERROR" : "—"}
      </span>
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold mb-2">Estado del sistema</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Ping del backend, credenciales y servicios críticos.
      </p>

      <div className="rounded-2xl p-[1px] bg-gradient-to-r from-indigo-500/40 via-fuchsia-500/40 to-emerald-500/40">
        <div className="rounded-2xl bg-background p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium">Resumen</h2>
            <Badge ok={globalOk} />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-lg border p-4">
              <h3 className="text-sm font-semibold mb-3">Servicios</h3>
              <Item label="Supabase" value={servicesOk.supabase} />
              <Item label="Redis" value={servicesOk.redis} />
              <Item label="WhatsApp server (Baileys)" value={servicesOk.wa_server} />
              <Item
                label="WhatsApp tenant por defecto"
                value={servicesOk.wa_default_tenant}
              />
              <Item
                label="Worker (heartbeat)"
                value={servicesOk.worker_heartbeat}
              />
            </div>

            <div className="rounded-lg border p-4">
              <h3 className="text-sm font-semibold mb-3">Entorno</h3>
              <Item
                label="NEXT_PUBLIC_SUPABASE_URL"
                value={envOk.NEXT_PUBLIC_SUPABASE_URL}
              />
              <Item
                label="SUPABASE_SERVICE_ROLE_KEY"
                value={envOk.SUPABASE_SERVICE_ROLE_KEY}
              />
              <Item label="REDIS_URL" value={envOk.REDIS_URL} />
              <Item label="OPENAI_API_KEY" value={envOk.OPENAI_API_KEY} />
              <Item label="WA_DEFAULT_TENANT_ID" value={envOk.WA_DEFAULT_TENANT_ID} />
            </div>
          </div>

          {queues && (
            <div className="rounded-lg border p-4 mt-4">
              <h3 className="text-sm font-semibold mb-3">Colas (BullMQ)</h3>
              <div className="grid md:grid-cols-2 gap-3">
                {Object.entries(queues).map(([name, q]: any) => (
                  <div key={name} className="rounded-md border p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">{name}</span>
                      <span className="text-xs text-muted-foreground">
                        {resp.kind === "queues" &&
                        (resp.data as any)?.[name] === "up"
                          ? "up"
                          : ""}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        waiting: <b>{q?.waiting ?? 0}</b>
                      </div>
                      <div>
                        active: <b>{q?.active ?? 0}</b>
                      </div>
                      <div>
                        completed: <b>{q?.completed ?? 0}</b>
                      </div>
                      <div>
                        failed: <b>{q?.failed ?? 0}</b>
                      </div>
                      <div>
                        delayed: <b>{q?.delayed ?? 0}</b>
                      </div>
                      <div>
                        paused: <b>{q?.paused ?? 0}</b>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {errorMsg && (
            <p className="mt-4 text-sm text-red-600">Error: {errorMsg}</p>
          )}
          <div className="flex gap-3 mt-4">
            <a href="/dashboard" className="text-sm underline">
              ← Volver
            </a>
            <a href="/api/health" className="text-sm underline">
              Ver JSON /api/health
            </a>
            <a href="/api/admin/status" className="text-sm underline">
              Ver JSON /api/admin/status
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
