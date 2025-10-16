// worker/utils/replies.ts
type Ctx = {
    serviceName?: string;
    dateLabel?: string;
    hourLabel?: string;
    resourceName?: string;
  };
  
  export function replyFor(intent: string | null, stage: string, ctx: Ctx = {}): string {
    // Respuestas cortas y claras
    if (intent === "cancelar") {
      return "Ok. ¿Cuál cita deseas cancelar? (ej. 'la de hoy a las 3')";
    }
    if (intent === "reprogramar") {
      return "Perfecto. ¿Para qué día deseas mover tu cita?";
    }
    if (intent === "estado") {
      return "Puedo verificar tu cita. ¿Me confirmas tu nombre o teléfono registrado?";
    }
    if (intent === "disponibilidad" && stage === "idle") {
      return "¿Para qué servicio quieres ver horarios? (Ej. Corte / Afeitado)";
    }
  
    switch (stage) {
      case "awaiting_service":
        return "Perfecto 🙌 ¿Para cuál servicio? (Ej. Corte de cabello / Afeitado)";
      case "awaiting_day":
        return `Anotado: ${ctx.serviceName ?? "el servicio"}. ¿Para qué día? (hoy, mañana, viernes)`;
      case "awaiting_slot":
        return `Genial. Te mostraré horarios en cuanto indiques el día.`;
      case "awaiting_confirm":
        return `Confirmo: ${ctx.serviceName ?? "servicio"}, ${ctx.dateLabel ?? "fecha"} a las ${ctx.hourLabel ?? "hora"}${ctx.resourceName ? ` con ${ctx.resourceName}` : ""}. ¿Agendo?`;
      default:
        // fallback / saludo
        if (intent === "saludo") {
          return "¡Hola! 👋 ¿Deseas reservar una cita o ver horarios disponibles?";
        }
        if (intent === "reservar") {
          return "¡Vamos a reservar! ¿Para cuál servicio? (Corte / Afeitado)";
        }
        return "Te leo. ¿Quieres *reservar* una cita o *ver horarios*?";
    }
  }
  