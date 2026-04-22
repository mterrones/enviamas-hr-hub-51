import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ApiHttpError } from "@/api/client";
import { fetchAllEmployees, type Employee } from "@/api/employees";
import { fetchAllAssetsForEmployee, type Asset } from "@/api/assets";
import {
  createDeductionInstallmentPlan,
  deleteDeductionInstallmentPlan,
  deleteDeductionPlanEvidence,
  downloadDeductionPlanEvidenceBlob,
  fetchDeductionInstallmentPlans,
  fetchIncomeTaxFifthPreview,
  fetchPayrollPeriods,
  fetchPrevisionalPreview,
  patchDeductionInstallmentPlan,
  previewAttendanceDeductions,
  uploadDeductionPlanEvidence,
  type DeductionInstallmentPlan,
  type DeductionInstallmentPlanWriteBody,
  type IncomeTaxFifthPreviewData,
  type PrevisionalPreviewData,
} from "@/api/payroll";
import type { PayrollPeriod } from "@/api/payroll";
import type { components } from "@/api/contracts";
import { formatEmployeeName } from "@/lib/employeeName";
import { formatAppDate, formatAppMonthYear } from "@/lib/formatAppDate";
import { formatRatioPercent, regimeResolvedLabel } from "@/lib/previsionalDisplay";
import { useAuth } from "@/contexts/AuthContext";
import { ClipboardCopy, Download, FileUp, Loader2, Pencil, Trash2, XCircle } from "lucide-react";

const CATEGORY_OPTIONS: { value: NonNullable<DeductionInstallmentPlanWriteBody["category"]>; label: string }[] = [
  { value: "damage_equipment", label: "Daño a equipo" },
  { value: "salary_advance", label: "Adelanto de sueldo" },
  { value: "loan", label: "Préstamo" },
  { value: "other", label: "Otro" },
];

function categoryLabel(slug: string | null | undefined): string {
  if (!slug) return "—";
  const row = CATEGORY_OPTIONS.find((c) => c.value === slug);
  return row?.label ?? slug;
}

function planStatusLabel(s: string): string {
  const m: Record<string, string> = {
    active: "Activo",
    completed: "Completado",
    cancelled: "Cancelado",
  };
  return m[s] ?? s;
}

function planStatusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "completed") return "secondary";
  if (s === "cancelled") return "destructive";
  return "default";
}

function mutationErrorMessage(e: unknown): string {
  if (e instanceof ApiHttpError) {
    const m = e.apiError?.message;
    if (typeof m === "string" && m.trim()) return m;
  }
  return "No se pudo completar la operación.";
}

function formatPen(amount: string): string {
  const n = Number.parseFloat(amount);
  if (Number.isNaN(n)) return amount;
  return `S/ ${n.toFixed(2)}`;
}

type AttendancePreviewData = components["schemas"]["AttendanceDeductionPreviewData"];

function defaultGrossFromEmployee(emp: Employee | undefined): string {
  if (!emp?.salary) return "";
  const n = Number.parseFloat(String(emp.salary).replace(",", "."));
  return Number.isNaN(n) ? "" : n.toFixed(2);
}

export default function DeductionsPage() {
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("payroll.generate");
  const canViewPayrollPreview = hasPermission("payroll.view");
  const [searchParams] = useSearchParams();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [employeeId, setEmployeeId] = useState<string>("");

  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [plans, setPlans] = useState<DeductionInstallmentPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<DeductionInstallmentPlan | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeductionInstallmentPlan | null>(null);
  const [cancelTarget, setCancelTarget] = useState<DeductionInstallmentPlan | null>(null);

  const [createLabel, setCreateLabel] = useState("");
  const [createCategory, setCreateCategory] = useState<string>("other");
  const [createDescription, setCreateDescription] = useState("");
  const [createTotal, setCreateTotal] = useState("");
  const [createMonths, setCreateMonths] = useState("");
  const [createPeriodId, setCreatePeriodId] = useState<string>("");
  const [createNotes, setCreateNotes] = useState("");
  const [createAssetId, setCreateAssetId] = useState<string>("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [createSaving, setCreateSaving] = useState(false);

  const [editLabel, setEditLabel] = useState("");
  const [editCategory, setEditCategory] = useState<string>("other");
  const [editDescription, setEditDescription] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editAssetId, setEditAssetId] = useState<string>("");
  const [editSaving, setEditSaving] = useState(false);

  const [evidencePlanId, setEvidencePlanId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [attPeriodId, setAttPeriodId] = useState("");
  const [attGrossInput, setAttGrossInput] = useState("");
  const [attPreview, setAttPreview] = useState<AttendancePreviewData | null>(null);
  const [attPreviewLoading, setAttPreviewLoading] = useState(false);
  const [attPrevisionalData, setAttPrevisionalData] = useState<PrevisionalPreviewData | null>(null);
  const [attPrevisionalError, setAttPrevisionalError] = useState<string | null>(null);
  const [attIncomeTaxFifthData, setAttIncomeTaxFifthData] = useState<IncomeTaxFifthPreviewData | null>(null);
  const [attIncomeTaxFifthError, setAttIncomeTaxFifthError] = useState<string | null>(null);

  useEffect(() => {
    const q = searchParams.get("employee");
    if (q != null && /^\d+$/.test(q.trim())) {
      setEmployeeId(q.trim());
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setEmployeesLoading(true);
      try {
        const list = await fetchAllEmployees({ status: "activo" });
        if (!cancelled) setEmployees(list);
      } catch {
        if (!cancelled) setEmployees([]);
      } finally {
        if (!cancelled) setEmployeesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchPayrollPeriods();
        if (!cancelled) setPeriods(r.data);
      } catch {
        if (!cancelled) setPeriods([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedEmpId = Number.parseInt(employeeId, 10);

  const pendingInstallmentPlans = useMemo(
    () =>
      plans.filter(
        (p) =>
          p.status === "active" &&
          p.next_installment_number != null &&
          p.next_installment_amount != null,
      ),
    [plans],
  );

  useEffect(() => {
    setAttPreview(null);
    setAttPrevisionalData(null);
    setAttPrevisionalError(null);
    setAttIncomeTaxFifthData(null);
    setAttIncomeTaxFifthError(null);
    const emp = employees.find((e) => e.id === selectedEmpId);
    setAttGrossInput(defaultGrossFromEmployee(emp));
    setAttPeriodId("");
  }, [employeeId, employees, selectedEmpId]);

  useEffect(() => {
    let cancelled = false;
    if (Number.isNaN(selectedEmpId)) {
      setAssets([]);
      setCreateAssetId("");
      return undefined;
    }
    (async () => {
      try {
        const list = await fetchAllAssetsForEmployee(selectedEmpId);
        if (!cancelled) {
          setAssets(list);
          setCreateAssetId("");
        }
      } catch {
        if (!cancelled) setAssets([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedEmpId]);

  const loadPlans = useCallback(async () => {
    if (Number.isNaN(selectedEmpId)) {
      setPlans([]);
      return;
    }
    setPlansLoading(true);
    try {
      const r = await fetchDeductionInstallmentPlans(selectedEmpId);
      setPlans(r.data);
    } catch (e) {
      toast({
        title: "Descuentos",
        description: mutationErrorMessage(e),
        variant: "destructive",
      });
      setPlans([]);
    } finally {
      setPlansLoading(false);
    }
  }, [selectedEmpId, toast]);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  const openCreate = () => {
    if (Number.isNaN(selectedEmpId)) {
      toast({ title: "Empleado requerido", description: "Selecciona un empleado.", variant: "destructive" });
      return;
    }
    setCreateLabel("");
    setCreateCategory("other");
    setCreateDescription("");
    setCreateTotal("");
    setCreateMonths("");
    setCreatePeriodId("");
    setCreateNotes("");
    setCreateAssetId("");
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (Number.isNaN(selectedEmpId)) return;
    const total = Number.parseFloat(createTotal.replace(",", ".")) || 0;
    const months = Number.parseInt(createMonths, 10);
    if (!createLabel.trim() || total < 0.01 || months < 1) {
      toast({
        title: "Datos incompletos",
        description: "Indica título, monto total y número de cuotas.",
        variant: "destructive",
      });
      return;
    }
    const body: DeductionInstallmentPlanWriteBody = {
      label: createLabel.trim(),
      total_amount: total,
      installment_count: months,
      category: createCategory as DeductionInstallmentPlanWriteBody["category"],
      description: createDescription.trim() || undefined,
      notes: createNotes.trim() || undefined,
      start_payroll_period_id: createPeriodId ? Number.parseInt(createPeriodId, 10) : undefined,
      asset_id: createAssetId ? Number.parseInt(createAssetId, 10) : undefined,
    };
    setCreateSaving(true);
    try {
      await createDeductionInstallmentPlan(selectedEmpId, body);
      toast({ title: "Plan registrado", description: "Puedes aplicar cuotas desde Boletas y Nómina al generar la boleta." });
      setCreateOpen(false);
      await loadPlans();
    } catch (e) {
      toast({ title: "No se pudo crear", description: mutationErrorMessage(e), variant: "destructive" });
    } finally {
      setCreateSaving(false);
    }
  };

  const openEdit = (p: DeductionInstallmentPlan) => {
    setEditTarget(p);
    setEditLabel(p.label);
    setEditCategory(p.category ?? "other");
    setEditDescription(p.description ?? "");
    setEditNotes(p.notes ?? "");
    setEditAssetId(p.asset_id != null ? String(p.asset_id) : "");
  };

  const handleEditSave = async () => {
    if (!editTarget || Number.isNaN(selectedEmpId)) return;
    setEditSaving(true);
    try {
      await patchDeductionInstallmentPlan(selectedEmpId, editTarget.id, {
        label: editLabel.trim(),
        category: editCategory as DeductionInstallmentPlanWriteBody["category"],
        description: editDescription.trim() || null,
        notes: editNotes.trim() || null,
        asset_id: editAssetId ? Number.parseInt(editAssetId, 10) : null,
      });
      toast({ title: "Actualizado", description: "Los datos del plan se guardaron." });
      setEditTarget(null);
      await loadPlans();
    } catch (e) {
      toast({ title: "Error", description: mutationErrorMessage(e), variant: "destructive" });
    } finally {
      setEditSaving(false);
    }
  };

  const handleCancelPlan = async () => {
    if (!cancelTarget || Number.isNaN(selectedEmpId)) return;
    try {
      await patchDeductionInstallmentPlan(selectedEmpId, cancelTarget.id, { status: "cancelled" });
      toast({ title: "Plan cancelado", description: "No se aplicarán más cuotas desde este plan." });
      setCancelTarget(null);
      await loadPlans();
    } catch (e) {
      toast({ title: "Error", description: mutationErrorMessage(e), variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || Number.isNaN(selectedEmpId)) return;
    try {
      await deleteDeductionInstallmentPlan(selectedEmpId, deleteTarget.id);
      toast({ title: "Eliminado", description: "El plan fue eliminado." });
      setDeleteTarget(null);
      await loadPlans();
    } catch (e) {
      toast({ title: "Error", description: mutationErrorMessage(e), variant: "destructive" });
    }
  };

  const triggerEvidencePick = (planId: number) => {
    setEvidencePlanId(planId);
    window.setTimeout(() => fileInputRef.current?.click(), 0);
  };

  const onEvidenceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || evidencePlanId == null || Number.isNaN(selectedEmpId)) return;
    try {
      await uploadDeductionPlanEvidence(selectedEmpId, evidencePlanId, file);
      toast({ title: "Evidencia guardada", description: "El archivo se adjuntó al plan." });
      await loadPlans();
    } catch (err) {
      toast({ title: "No se pudo subir", description: mutationErrorMessage(err), variant: "destructive" });
    } finally {
      setEvidencePlanId(null);
    }
  };

  const handleDownloadEvidence = async (plan: DeductionInstallmentPlan) => {
    if (Number.isNaN(selectedEmpId)) return;
    try {
      const blob = await downloadDeductionPlanEvidenceBlob(selectedEmpId, plan.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `evidencia-plan-${plan.id}`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ title: "Descarga", description: mutationErrorMessage(err), variant: "destructive" });
    }
  };

  const handleRemoveEvidence = async (plan: DeductionInstallmentPlan) => {
    if (Number.isNaN(selectedEmpId)) return;
    try {
      await deleteDeductionPlanEvidence(selectedEmpId, plan.id);
      toast({ title: "Evidencia eliminada" });
      await loadPlans();
    } catch (err) {
      toast({ title: "Error", description: mutationErrorMessage(err), variant: "destructive" });
    }
  };

  const loadAttendancePreview = useCallback(async () => {
    if (Number.isNaN(selectedEmpId) || !attPeriodId) {
      toast({ title: "Periodo requerido", description: "Selecciona un periodo de nómina.", variant: "destructive" });
      return;
    }
    setAttPreviewLoading(true);
    setAttPrevisionalData(null);
    setAttPrevisionalError(null);
    setAttIncomeTaxFifthData(null);
    setAttIncomeTaxFifthError(null);
    try {
      const grossParsed = Number.parseFloat(attGrossInput.replace(",", "."));
      const body: {
        employee_id: number;
        payroll_period_id: number;
        gross_amount?: number;
      } = {
        employee_id: selectedEmpId,
        payroll_period_id: Number.parseInt(attPeriodId, 10),
      };
      const hasGross = Number.isFinite(grossParsed) && grossParsed > 0;
      if (hasGross) {
        body.gross_amount = grossParsed;
      }
      const res = await previewAttendanceDeductions(body);
      setAttPreview(res.data);

      if (hasGross) {
        try {
          const prevRes = await fetchPrevisionalPreview({
            employee_id: selectedEmpId,
            payroll_period_id: Number.parseInt(attPeriodId, 10),
            gross_amount: grossParsed,
          });
          setAttPrevisionalData(prevRes.data);
        } catch (pe) {
          setAttPrevisionalData(null);
          setAttPrevisionalError(mutationErrorMessage(pe));
        }
        try {
          const fifthRes = await fetchIncomeTaxFifthPreview({
            payroll_period_id: Number.parseInt(attPeriodId, 10),
            gross_amount: grossParsed,
          });
          setAttIncomeTaxFifthData(fifthRes.data);
        } catch (fe) {
          setAttIncomeTaxFifthData(null);
          setAttIncomeTaxFifthError(mutationErrorMessage(fe));
        }
      }
    } catch (e) {
      toast({ title: "Sugerencia asistencia", description: mutationErrorMessage(e), variant: "destructive" });
      setAttPreview(null);
      setAttPrevisionalData(null);
      setAttPrevisionalError(null);
      setAttIncomeTaxFifthData(null);
      setAttIncomeTaxFifthError(null);
    } finally {
      setAttPreviewLoading(false);
    }
  }, [selectedEmpId, attPeriodId, attGrossInput, toast]);

  const buildInstallmentCopyLines = (): string[] => {
    if (pendingInstallmentPlans.length === 0) return [];
    const out: string[] = [
      "",
      "--- Planes de descuento activos (referencia) ---",
      "Esta cuota se aplica realmente desde Boletas y Nómina al añadirla al desglose y aprobar la boleta.",
      "",
    ];
    for (const p of pendingInstallmentPlans) {
      out.push(
        `Plan: ${p.label}`,
        `Categoría: ${categoryLabel(p.category)}`,
        `Próxima cuota: ${p.next_installment_number} de ${p.installment_count}`,
        `Importe sugerido: ${formatPen(p.next_installment_amount)}`,
        `Saldo pendiente: ${formatPen(p.remaining_total_amount)}`,
        `Código desglose: installment:${p.id}`,
      );
      if (p.asset) {
        out.push(
          `Equipo: ${p.asset.type}${p.asset.model != null && p.asset.model !== "" ? ` · ${p.asset.model}` : ""}`,
        );
      }
      out.push("");
    }
    return out;
  };

  const copyAttendanceSummary = async () => {
    if (!attPreview && pendingInstallmentPlans.length === 0) return;
    const selectedEmployee = employees.find((e) => e.id === selectedEmpId);
    const refHead =
      selectedEmployee != null
        ? `Referencia de descuentos — ${formatEmployeeName(selectedEmployee)}`
        : `Referencia de descuentos — #${selectedEmpId}`;
    const baseLines = attPreview
      ? [
      `Periodo: ${attPreview.period_from} a ${attPreview.period_to}`,
      `Faltas no justificadas (descuento): ${attPreview.absence_days_unjustified}`,
      `Faltas justificadas (info): ${attPreview.absence_days_justified}`,
      `Tardanzas no justificadas (descuento): ${attPreview.tardiness_events_unjustified}`,
      `Tardanzas justificadas (info): ${attPreview.tardiness_events_justified}`,
      `Déficit minutos (NJ): ${attPreview.tardiness_deficit_minutes}`,
      `Vacaciones: ${attPreview.vacation_records} · Recuperación: ${attPreview.recuperacion_records} · Asistido: ${attPreview.asistido_records}`,
      attPreview.suggested_amounts_computed
        ? `Sugerido faltas NJ: S/ ${attPreview.suggested_deduction_absence.toFixed(2)} · tardanzas NJ: S/ ${attPreview.suggested_deduction_lateness.toFixed(2)} (bruto ${attPreview.gross_amount_basis})`
        : "Montos sugeridos no calculados (indica bruto o usa solo conteos).",
      "",
      attPreview.formula_note,
    ]
      : [refHead, "", "Sugerencia de asistencia: no calculada. Presioná «Calcular sugerencia» para incluir asistencia y previsional."];
    const previsionalLines: string[] = [];
    if (attPreview) {
      if (!attPreview.suggested_amounts_computed) {
        previsionalLines.push("", "Descuento previsional (referencia): ingresa un bruto mensual para calcular la referencia.");
      } else if (attPrevisionalError) {
        previsionalLines.push("", `Descuento previsional (referencia, error): ${attPrevisionalError}`);
      } else if (attPrevisionalData) {
        previsionalLines.push("", "--- Descuento previsional (referencia) ---");
        if (attPrevisionalData.status === "unsupported_regime") {
          previsionalLines.push(
            `Régimen no soportado para cálculo automático${
              attPrevisionalData.pension_fund_original != null && attPrevisionalData.pension_fund_original !== ""
                ? ` (${attPrevisionalData.pension_fund_original})`
                : ""
            }. Revisá la ficha del empleado.`,
          );
        } else if (attPrevisionalData.status === "missing_legal_rate") {
          previsionalLines.push(
            `Sin tasa legal para la fecha ${attPrevisionalData.reference_date}${
              attPrevisionalData.legal_parameter_key != null ? ` (${attPrevisionalData.legal_parameter_key})` : ""
            }`,
          );
        } else {
          previsionalLines.push(
            `Sistema detectado: ${regimeResolvedLabel(attPrevisionalData.regime_resolved)}`,
            attPrevisionalData.pension_fund_original != null && attPrevisionalData.pension_fund_original !== ""
              ? `Texto en perfil: ${attPrevisionalData.pension_fund_original}`
              : "Texto en perfil: —",
            `Tasa aplicada: ${formatRatioPercent(attPrevisionalData.ratio)}`,
            `Base (bruto): ${attPrevisionalData.base_amount}`,
            `Monto sugerido: ${attPrevisionalData.amount ?? "—"}`,
            `Fecha referencia legal: ${attPrevisionalData.reference_date}`,
          );
        }
      }
    }
    const incomeTaxFifthLines: string[] = [];
    if (attPreview) {
      if (!attPreview.suggested_amounts_computed) {
        incomeTaxFifthLines.push(
          "",
          "Impuesto a la renta 5ta categoría (referencia): ingresa un bruto mensual para calcular la referencia de renta.",
        );
      } else if (attIncomeTaxFifthError) {
        incomeTaxFifthLines.push("", `Impuesto a la renta 5ta categoría (referencia, error): ${attIncomeTaxFifthError}`);
      } else if (attIncomeTaxFifthData) {
        incomeTaxFifthLines.push("", "--- Impuesto a la renta 5ta categoría (referencia) ---");
        if (attIncomeTaxFifthData.status === "missing_uit") {
          incomeTaxFifthLines.push(
            "No se puede calcular renta porque falta UIT vigente en Parámetros legales.",
            `Proyección anual (referencia, sin UIT): ${attIncomeTaxFifthData.annual_projected_gross}`,
          );
        } else if (attIncomeTaxFifthData.status === "invalid_gross") {
          incomeTaxFifthLines.push("Estado: bruto no válido para el cálculo de renta.");
        } else {
          const grossUsed =
            attPreview.gross_amount_basis != null ? String(attPreview.gross_amount_basis) : attGrossInput.trim() || "—";
          incomeTaxFifthLines.push(
            `Estado: ${attIncomeTaxFifthData.status}`,
            `Versión cálculo: ${attIncomeTaxFifthData.calculation_version}`,
            `UIT usada (PEN): ${attIncomeTaxFifthData.uit_pen ?? "—"}`,
            `Bruto mensual usado: ${grossUsed}`,
            `Renta anual proyectada: ${attIncomeTaxFifthData.annual_projected_gross}`,
            `Deducción 7 UIT: ${attIncomeTaxFifthData.deduction_7_uit_amount ?? "—"}`,
            `Base imponible anual: ${attIncomeTaxFifthData.taxable_annual_base ?? "—"}`,
            `Impuesto anual estimado: ${attIncomeTaxFifthData.annual_tax ?? "—"}`,
            `Retención mensual sugerida: ${attIncomeTaxFifthData.monthly_suggested_retention ?? "—"}`,
            `Tasa efectiva (sobre proyección anual): ${
              attIncomeTaxFifthData.effective_rate != null
                ? `${(Number.parseFloat(attIncomeTaxFifthData.effective_rate) * 100).toFixed(2)}%`
                : "—"
            }`,
            `Fecha referencia legal: ${attIncomeTaxFifthData.reference_date}`,
          );
          const monthlyStr = attIncomeTaxFifthData.monthly_suggested_retention;
          if (monthlyStr != null && Number.parseFloat(monthlyStr) === 0) {
            incomeTaxFifthLines.push(
              "No se sugiere retención porque la proyección anual no supera 7 UIT.",
            );
          }
        }
      }
    }
    const text = [...baseLines, ...previsionalLines, ...incomeTaxFifthLines, ...buildInstallmentCopyLines()].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copiado", description: "Resumen en el portapapeles." });
    } catch {
      toast({ title: "No se pudo copiar", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        className="hidden"
        onChange={onEvidenceFile}
      />

      <div>
        <h1 className="text-2xl font-bold">Descuentos</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Planes de descuento en cuotas por empleado. Las cuotas se aplican al aprobar boletas con código{" "}
          <span className="font-mono text-xs">installment:ID</span>.
        </p>
      </div>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">Seleccionar empleado</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1 space-y-2">
            <Label>Empleado</Label>
            <Select
              value={employeeId}
              onValueChange={setEmployeeId}
              disabled={employeesLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={employeesLoading ? "Cargando…" : "Elegir empleado"} />
              </SelectTrigger>
              <SelectContent>
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={String(emp.id)}>
                    {formatEmployeeName(emp)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="outline" onClick={() => void loadPlans()} disabled={!employeeId || plansLoading}>
            Actualizar
          </Button>
          {canManage ? (
            <Button type="button" onClick={openCreate} disabled={!employeeId}>
              Nuevo plan de cuotas
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {employeeId ? (
        <>
          {canViewPayrollPreview ? (
            <Card className="shadow-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Sugerencia de descuento</CardTitle>
                <p className="text-sm text-muted-foreground font-normal leading-relaxed pt-1">
                  Resumen referencial de descuentos del período. No crea descuentos ni modifica boletas. Para aplicar en
                  boleta usá{" "}
                  <Link to="/boletas" className="text-primary underline">
                    Boletas y Nómina
                  </Link>
                  .
                </p>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-sm">Periodo de nómina</Label>
                    <Select value={attPeriodId || "__none__"} onValueChange={(v) => setAttPeriodId(v === "__none__" ? "" : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Elegir periodo" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">—</SelectItem>
                        {periods.map((per) => (
                          <SelectItem key={per.id} value={String(per.id)}>
                            {formatAppMonthYear(per.month, per.year)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Bruto mensual (PEN, opcional)</Label>
                    <Input
                      value={attGrossInput}
                      onChange={(e) => setAttGrossInput(e.target.value)}
                      placeholder="Ej: sueldo del perfil"
                      inputMode="decimal"
                    />
                    <p className="text-sm text-muted-foreground">
                      Si está vacío o 0, solo verás conteos; los importes sugeridos requieren un monto base.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={!attPeriodId || attPreviewLoading}
                    onClick={() => void loadAttendancePreview()}
                  >
                    {attPreviewLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Calculando…
                      </>
                    ) : (
                      "Calcular sugerencia"
                    )}
                  </Button>
                  {attPreview || pendingInstallmentPlans.length > 0 ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => void copyAttendanceSummary()}>
                      <ClipboardCopy className="w-4 h-4 mr-2" /> Copiar resumen
                    </Button>
                  ) : null}
                </div>

                {attPreview ? (
                  <div className="rounded-lg border border-border bg-muted/10 p-4 space-y-3">
                    <h3 className="text-sm font-semibold text-foreground">Resumen por asistencia</h3>
                    <div className="overflow-x-auto -mx-1 px-1">
                      <table className="w-full text-sm">
                        <tbody className="[&_td]:py-2 [&_td]:align-top [&_tr]:border-b [&_tr]:border-border/60 last:[&_tr]:border-0">
                          <tr>
                            <td className="pr-4 text-muted-foreground w-[min(14rem,45%)]">Período considerado</td>
                            <td className="font-medium tabular-nums">
                              {attPreview.period_from} → {attPreview.period_to}
                            </td>
                          </tr>
                          <tr>
                            <td className="pr-4 text-muted-foreground">Faltas no justificadas</td>
                            <td className="font-medium">{attPreview.absence_days_unjustified}</td>
                          </tr>
                          <tr>
                            <td className="pr-4 text-muted-foreground">Faltas justificadas</td>
                            <td className="font-medium">{attPreview.absence_days_justified}</td>
                          </tr>
                          <tr>
                            <td className="pr-4 text-muted-foreground">Tardanzas NJ</td>
                            <td className="font-medium">
                              {attPreview.tardiness_events_unjustified} · déficit {attPreview.tardiness_deficit_minutes} min
                            </td>
                          </tr>
                          <tr>
                            <td className="pr-4 text-muted-foreground">Tardanzas justificadas</td>
                            <td className="font-medium">{attPreview.tardiness_events_justified}</td>
                          </tr>
                          <tr>
                            <td className="pr-4 text-muted-foreground">Vacaciones</td>
                            <td className="font-medium">{attPreview.vacation_records}</td>
                          </tr>
                          <tr>
                            <td className="pr-4 text-muted-foreground">Recuperación</td>
                            <td className="font-medium">{attPreview.recuperacion_records}</td>
                          </tr>
                          <tr>
                            <td className="pr-4 text-muted-foreground">Asistido</td>
                            <td className="font-medium">{attPreview.asistido_records}</td>
                          </tr>
                          <tr>
                            <td className="pr-4 text-muted-foreground">Sugerido faltas NJ</td>
                            <td className="font-medium">
                              {attPreview.suggested_amounts_computed
                                ? formatPen(String(attPreview.suggested_deduction_absence))
                                : "—"}
                            </td>
                          </tr>
                          <tr>
                            <td className="pr-4 text-muted-foreground">Sugerido tardanzas NJ</td>
                            <td className="font-medium">
                              {attPreview.suggested_amounts_computed
                                ? formatPen(String(attPreview.suggested_deduction_lateness))
                                : "—"}
                            </td>
                          </tr>
                          <tr>
                            <td className="pr-4 text-muted-foreground">Bruto usado</td>
                            <td className="font-medium">
                              {attPreview.suggested_amounts_computed
                                ? formatPen(String(attPreview.gross_amount_basis))
                                : "—"}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    {!attPreview.suggested_amounts_computed ? (
                      <p className="text-sm text-muted-foreground border-t border-border/60 pt-3">
                        Indicá un bruto mayor que cero para ver montos sugeridos; jornada referencia {attPreview.full_time_daily_minutes}{" "}
                        min/día.
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/60 pt-3">
                      {attPreview.formula_note}
                    </p>
                  </div>
                ) : null}

                {attPreview ? (
                  <div className="rounded-lg border border-border bg-muted/10 p-4 space-y-3">
                    <h3 className="text-sm font-semibold text-foreground">Descuento previsional</h3>
                    <p className="text-sm text-muted-foreground">
                      Según sistema previsional del perfil y parámetros legales vigentes.
                    </p>
                    {!attPreview.suggested_amounts_computed ? (
                      <p className="text-sm text-muted-foreground">
                        Ingresá un bruto mensual para calcular la referencia previsional.
                      </p>
                    ) : attPrevisionalError ? (
                      <p className="text-sm text-destructive">{attPrevisionalError}</p>
                    ) : attPrevisionalData == null ? (
                      <p className="text-sm text-muted-foreground">—</p>
                    ) : attPrevisionalData.status === "unsupported_regime" ? (
                      <p className="text-sm text-amber-800 dark:text-amber-200/90">
                        Régimen no soportado para cálculo automático
                        {attPrevisionalData.pension_fund_original != null && attPrevisionalData.pension_fund_original !== ""
                          ? ` (${attPrevisionalData.pension_fund_original})`
                          : ""}
                        . Revisá la ficha del empleado o cargá la boleta manualmente en Boletas y Nómina.
                      </p>
                    ) : attPrevisionalData.status === "missing_legal_rate" ? (
                      <p className="text-sm text-amber-800 dark:text-amber-200/90">
                        No hay tasa legal configurada para la fecha de referencia{" "}
                        {formatAppDate(attPrevisionalData.reference_date)}.
                        {attPrevisionalData.legal_parameter_key != null
                          ? ` (${attPrevisionalData.legal_parameter_key})`
                          : ""}
                      </p>
                    ) : (
                      <div className="overflow-x-auto -mx-1 px-1">
                        <table className="w-full text-sm max-w-xl">
                          <tbody className="[&_td]:py-2 [&_td]:align-top [&_tr]:border-b [&_tr]:border-border/60 last:[&_tr]:border-0">
                            <tr>
                              <td className="pr-4 text-muted-foreground w-[min(12rem,42%)]">Sistema detectado</td>
                              <td className="font-medium">{regimeResolvedLabel(attPrevisionalData.regime_resolved)}</td>
                            </tr>
                            <tr>
                              <td className="pr-4 text-muted-foreground">Texto en perfil</td>
                              <td className="font-medium">
                                {attPrevisionalData.pension_fund_original != null &&
                                attPrevisionalData.pension_fund_original !== ""
                                  ? attPrevisionalData.pension_fund_original
                                  : "—"}
                              </td>
                            </tr>
                            <tr>
                              <td className="pr-4 text-muted-foreground">Tasa aplicada</td>
                              <td className="font-medium">{formatRatioPercent(attPrevisionalData.ratio)}</td>
                            </tr>
                            <tr>
                              <td className="pr-4 text-muted-foreground">Base (bruto usado)</td>
                              <td className="font-medium">{formatPen(attPrevisionalData.base_amount)}</td>
                            </tr>
                            <tr>
                              <td className="pr-4 text-muted-foreground">Fecha referencia legal</td>
                              <td className="font-medium">{formatAppDate(attPrevisionalData.reference_date)}</td>
                            </tr>
                            <tr>
                              <td className="pr-4 text-muted-foreground">Monto sugerido</td>
                              <td className="font-semibold text-destructive tabular-nums">
                                {attPrevisionalData.amount != null ? formatPen(attPrevisionalData.amount) : "—"}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : null}

                {attPreview ? (
                  <div className="rounded-lg border border-border bg-muted/10 p-4 space-y-3">
                    <h3 className="text-sm font-semibold text-foreground">Impuesto a la renta 5ta categoría (referencia)</h3>
                    <p className="text-sm text-muted-foreground">
                      Cálculo referencial (misma lógica que en Boletas y Nómina). No crea descuentos ni modifica boletas.
                    </p>
                    {!attPreview.suggested_amounts_computed ? (
                      <p className="text-sm text-muted-foreground">
                        Ingresa un bruto mensual para calcular la referencia de renta.
                      </p>
                    ) : attIncomeTaxFifthError ? (
                      <p className="text-sm text-destructive">{attIncomeTaxFifthError}</p>
                    ) : attIncomeTaxFifthData == null ? (
                      <p className="text-sm text-muted-foreground">—</p>
                    ) : attIncomeTaxFifthData.status === "missing_uit" ? (
                      <p className="text-sm text-amber-800 dark:text-amber-200/90">
                        No se puede calcular renta porque falta UIT vigente en Parámetros legales.
                      </p>
                    ) : attIncomeTaxFifthData.status === "invalid_gross" ? (
                      <p className="text-sm text-muted-foreground">Bruto no válido para el cálculo.</p>
                    ) : (
                      <div className="space-y-3">
                        <div className="overflow-x-auto -mx-1 px-1">
                          <table className="w-full text-sm max-w-xl">
                            <tbody className="[&_td]:py-2 [&_td]:align-top [&_tr]:border-b [&_tr]:border-border/60 last:[&_tr]:border-0">
                              <tr>
                                <td className="pr-4 text-muted-foreground w-[min(12rem,42%)]">Estado del cálculo</td>
                                <td className="font-medium">{attIncomeTaxFifthData.status}</td>
                              </tr>
                              <tr>
                                <td className="pr-4 text-muted-foreground">Versión</td>
                                <td className="font-medium font-mono text-xs">{attIncomeTaxFifthData.calculation_version}</td>
                              </tr>
                              <tr>
                                <td className="pr-4 text-muted-foreground">UIT usada (PEN)</td>
                                <td className="font-medium tabular-nums">
                                  {attIncomeTaxFifthData.uit_pen != null ? formatPen(attIncomeTaxFifthData.uit_pen) : "—"}
                                </td>
                              </tr>
                              <tr>
                                <td className="pr-4 text-muted-foreground">Bruto mensual usado</td>
                                <td className="font-medium tabular-nums">
                                  {attPreview.gross_amount_basis != null
                                    ? formatPen(String(attPreview.gross_amount_basis))
                                    : attGrossInput.trim() !== ""
                                      ? formatPen(attGrossInput)
                                      : "—"}
                                </td>
                              </tr>
                              <tr>
                                <td className="pr-4 text-muted-foreground">Renta anual proyectada</td>
                                <td className="font-medium tabular-nums">
                                  {formatPen(attIncomeTaxFifthData.annual_projected_gross)}
                                </td>
                              </tr>
                              <tr>
                                <td className="pr-4 text-muted-foreground">Deducción 7 UIT</td>
                                <td className="font-medium tabular-nums">
                                  {attIncomeTaxFifthData.deduction_7_uit_amount != null
                                    ? formatPen(attIncomeTaxFifthData.deduction_7_uit_amount)
                                    : "—"}
                                </td>
                              </tr>
                              <tr>
                                <td className="pr-4 text-muted-foreground">Base imponible anual</td>
                                <td className="font-medium tabular-nums">
                                  {attIncomeTaxFifthData.taxable_annual_base != null
                                    ? formatPen(attIncomeTaxFifthData.taxable_annual_base)
                                    : "—"}
                                </td>
                              </tr>
                              <tr>
                                <td className="pr-4 text-muted-foreground">Impuesto anual estimado</td>
                                <td className="font-medium tabular-nums">
                                  {attIncomeTaxFifthData.annual_tax != null ? formatPen(attIncomeTaxFifthData.annual_tax) : "—"}
                                </td>
                              </tr>
                              <tr>
                                <td className="pr-4 text-muted-foreground">Retención mensual sugerida</td>
                                <td className="font-semibold text-destructive tabular-nums">
                                  {attIncomeTaxFifthData.monthly_suggested_retention != null
                                    ? formatPen(attIncomeTaxFifthData.monthly_suggested_retention)
                                    : "—"}
                                </td>
                              </tr>
                              <tr>
                                <td className="pr-4 text-muted-foreground">Tasa efectiva</td>
                                <td className="font-medium">
                                  {attIncomeTaxFifthData.effective_rate != null
                                    ? `${(Number.parseFloat(attIncomeTaxFifthData.effective_rate) * 100).toFixed(2)}%`
                                    : "—"}
                                </td>
                              </tr>
                              <tr>
                                <td className="pr-4 text-muted-foreground">Fecha referencia legal</td>
                                <td className="font-medium">{formatAppDate(attIncomeTaxFifthData.reference_date)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        {attIncomeTaxFifthData.monthly_suggested_retention != null &&
                        Number.parseFloat(attIncomeTaxFifthData.monthly_suggested_retention) === 0 ? (
                          <p className="text-sm text-muted-foreground border-t border-border/60 pt-3">
                            No se sugiere retención porque la proyección anual no supera 7 UIT.
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : null}

                <div className="rounded-lg border border-border bg-muted/10 p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">Planes de descuento activos</h3>
                  <p className="text-sm text-muted-foreground">
                    Próxima cuota según el plan (no depende del período elegido arriba). Se aplica desde{" "}
                    <Link to="/boletas" className="text-primary underline">
                      Boletas y Nómina
                    </Link>{" "}
                    al incluir la línea en el desglose y aprobar la boleta.
                  </p>
                  {pendingInstallmentPlans.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No hay planes de cuotas con cuotas pendientes.</p>
                  ) : (
                    <div className="overflow-x-auto -mx-1 px-1">
                      <table className="w-full text-sm min-w-[640px]">
                        <thead>
                          <tr className="border-b border-border bg-muted/40 text-left">
                            <th className="p-2 font-medium">Título</th>
                            <th className="p-2 font-medium">Categoría</th>
                            <th className="p-2 font-medium whitespace-nowrap">Próxima cuota</th>
                            <th className="p-2 font-medium whitespace-nowrap">Monto</th>
                            <th className="p-2 font-medium whitespace-nowrap">Saldo pendiente</th>
                            <th className="p-2 font-medium">Equipo</th>
                            <th className="p-2 font-medium whitespace-nowrap">Código</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pendingInstallmentPlans.map((p) => (
                            <tr key={p.id} className="border-b border-border/60 last:border-0">
                              <td className="p-2 align-top font-medium">{p.label}</td>
                              <td className="p-2 align-top">{categoryLabel(p.category)}</td>
                              <td className="p-2 align-top tabular-nums whitespace-nowrap">
                                {p.next_installment_number} / {p.installment_count}
                              </td>
                              <td className="p-2 align-top tabular-nums whitespace-nowrap">
                                {p.next_installment_amount != null ? formatPen(p.next_installment_amount) : "—"}
                              </td>
                              <td className="p-2 align-top tabular-nums whitespace-nowrap">{formatPen(p.remaining_total_amount)}</td>
                              <td className="p-2 align-top text-muted-foreground">
                                {p.asset
                                  ? `${p.asset.type}${p.asset.model != null && p.asset.model !== "" ? ` · ${p.asset.model}` : ""}`
                                  : "—"}
                              </td>
                              <td className="p-2 align-top font-mono text-xs text-muted-foreground whitespace-nowrap">
                                installment:{p.id}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : null}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Planes de descuento</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {plansLoading ? (
              <p className="p-6 text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
              </p>
            ) : plans.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">No hay planes para este empleado.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left">
                      <th className="p-3 font-medium">Título</th>
                      <th className="p-3 font-medium">Categoría</th>
                      <th className="p-3 font-medium">Estado</th>
                      <th className="p-3 font-medium">Progreso</th>
                      <th className="p-3 font-medium">Pendiente</th>
                      <th className="p-3 font-medium">Equipo</th>
                      <th className="p-3 font-medium">Evidencia</th>
                      <th className="p-3 font-medium text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plans.map((p) => (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="p-3 align-top">
                          <div className="font-medium">{p.label}</div>
                          {p.description ? (
                            <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{p.description}</div>
                          ) : null}
                        </td>
                        <td className="p-3 align-top">{categoryLabel(p.category)}</td>
                        <td className="p-3 align-top">
                          <Badge variant={planStatusVariant(p.status)}>{planStatusLabel(p.status)}</Badge>
                        </td>
                        <td className="p-3 align-top whitespace-nowrap">
                          {p.installments_applied} / {p.installment_count}
                        </td>
                        <td className="p-3 align-top">{formatPen(p.remaining_total_amount)}</td>
                        <td className="p-3 align-top text-xs">
                          {p.asset ? (
                            <span>
                              {p.asset.type}
                              {p.asset.model ? ` · ${p.asset.model}` : ""}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-3 align-top">
                          {p.has_evidence ? (
                            <div className="flex flex-wrap gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2"
                                onClick={() => void handleDownloadEvidence(p)}
                              >
                                <Download className="w-3.5 h-3.5 mr-1" /> Ver
                              </Button>
                              {canManage ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-destructive"
                                  onClick={() => void handleRemoveEvidence(p)}
                                >
                                  Quitar
                                </Button>
                              ) : null}
                            </div>
                          ) : canManage ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7"
                              onClick={() => triggerEvidencePick(p.id)}
                            >
                              <FileUp className="w-3.5 h-3.5 mr-1" /> Subir
                            </Button>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-3 align-top text-right">
                          <div className="flex flex-wrap justify-end gap-1">
                            {canManage ? (
                              <>
                                <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => openEdit(p)}>
                                  <Pencil className="w-3.5 h-3.5 mr-1" /> Editar
                                </Button>
                                {p.status === "active" ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-8"
                                    onClick={() => setCancelTarget(p)}
                                  >
                                    <XCircle className="w-3.5 h-3.5 mr-1" /> Cancelar
                                  </Button>
                                ) : null}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 text-destructive"
                                  onClick={() => setDeleteTarget(p)}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </>
                            ) : (
                              <span className="text-xs text-muted-foreground">Solo lectura</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Elige un empleado para ver y gestionar sus descuentos.</p>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuevo plan de cuotas</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Título *</Label>
              <Input value={createLabel} onChange={(e) => setCreateLabel(e.target.value)} placeholder="Ej: Daño laptop" />
            </div>
            <div className="space-y-1.5">
              <Label>Categoría</Label>
              <Select value={createCategory} onValueChange={setCreateCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Descripción</Label>
              <Textarea value={createDescription} onChange={(e) => setCreateDescription(e.target.value)} rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Monto total (PEN) *</Label>
                <Input value={createTotal} onChange={(e) => setCreateTotal(e.target.value)} placeholder="600.00" />
              </div>
              <div className="space-y-1.5">
                <Label>N.º cuotas *</Label>
                <Input value={createMonths} onChange={(e) => setCreateMonths(e.target.value)} placeholder="3" inputMode="numeric" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Periodo de inicio (opcional)</Label>
              <Select value={createPeriodId || "__none__"} onValueChange={(v) => setCreatePeriodId(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Sin definir" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin definir</SelectItem>
                  {periods.map((per) => (
                    <SelectItem key={per.id} value={String(per.id)}>
                      {per.year}-{String(per.month).padStart(2, "0")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Activo / equipo (opcional)</Label>
              <Select value={createAssetId || "__none__"} onValueChange={(v) => setCreateAssetId(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Ninguno" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Ninguno</SelectItem>
                  {assets.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.type} {a.model ? `· ${a.model}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notas internas</Label>
              <Textarea value={createNotes} onChange={(e) => setCreateNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Cerrar
            </Button>
            <Button type="button" onClick={() => void handleCreate()} disabled={createSaving}>
              {createSaving ? "Guardando…" : "Crear plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editTarget != null} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar plan</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Título</Label>
              <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Categoría</Label>
              <Select value={editCategory} onValueChange={setEditCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Descripción</Label>
              <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={3} />
            </div>
            <div className="space-y-1.5">
              <Label>Activo / equipo</Label>
              <Select value={editAssetId || "__none__"} onValueChange={(v) => setEditAssetId(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Ninguno</SelectItem>
                  {assets.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.type} {a.model ? `· ${a.model}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notas</Label>
              <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={2} />
            </div>
            {editTarget ? (
              <p className="text-xs text-muted-foreground">
                Monto total y cuotas no se editan aquí; usa Boletas para aplicar cada cuota al aprobar.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>
              Cerrar
            </Button>
            <Button type="button" onClick={() => void handleEditSave()} disabled={editSaving}>
              {editSaving ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={cancelTarget != null} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar este plan?</AlertDialogTitle>
            <AlertDialogDescription>
              No se descontarán más cuotas desde este plan. Las cuotas ya aplicadas en boletas aprobadas no se revierten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <Button type="button" variant="destructive" onClick={() => void handleCancelPlan()}>
              Cancelar plan
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteTarget != null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar plan?</AlertDialogTitle>
            <AlertDialogDescription>
              Solo elimina el registro del plan. Si hubo cuotas en boletas, el historial de nómina no cambia.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <Button type="button" variant="destructive" onClick={() => void handleDelete()}>
              Eliminar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
