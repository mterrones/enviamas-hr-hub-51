export function regimeResolvedLabel(regime: string): string {
  switch (regime) {
    case "onp":
      return "ONP";
    case "afp_integra":
      return "AFP Integra";
    case "afp_prima":
      return "AFP Prima";
    case "afp_profuturo":
      return "AFP Profuturo";
    case "afp_habitat":
      return "AFP Habitat";
    case "unsupported":
      return "No soportado";
    default:
      return regime;
  }
}

export function formatRatioPercent(ratio: string | null | undefined): string {
  if (ratio == null || ratio === "") return "—";
  const n = Number.parseFloat(ratio);
  if (Number.isNaN(n)) return ratio;
  return `${(n * 100).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;
}
