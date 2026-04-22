import { useCallback, useEffect, useMemo, useState, type Dispatch, type MouseEvent, type SetStateAction } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Download, Send, Plus, Pencil, Trash2, CheckCircle2, ClipboardList, ExternalLink } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ApiHttpError } from "@/api/client";
import { fetchDepartments, type Department } from "@/api/departments";
import { fetchAllEmployees, type Employee } from "@/api/employees";
import {
  createPayrollPeriod,
  createPayslip,
  deletePayslip,
  approvePayslip,
  updatePayslip,
  notifyPayslipsForPeriod,
  downloadPayslipPdf,
  downloadPayrollSummaryPdf,
  downloadPayrollPayslipsZip,
  downloadPayrollSummaryXlsx,
  fetchPayrollPeriods,
  fetchAllPayslipsForPeriod,
  fetchIncomeTaxFifthPreview,
  fetchPrevisionalPreview,
  previewAttendanceDeductions,
  applyPrevisionalToPayslip,
  fetchDeductionInstallmentPlans,
  createDeductionInstallmentPlan,
  type Payslip,
  type PayrollPeriod,
  type IncomeTaxFifthPreviewData,
  type PrevisionalPreviewData,
  type DeductionInstallmentPlan,
} from "@/api/payroll";
import {
  type DeductionLineDraft,
  newDeductionLine,
  sumDeductionLineAmounts,
  deductionLinesFromPayslipMeta,
  buildPayslipBreakdownMeta,
} from "@/lib/payrollDeductionHelpers";
import {
  appendAbsenceSuggestionFromPreview,
  appendLatenessSuggestionFromPreview,
  ATTENDANCE_DEDUCTION_LINE_CODE_ABSENCE,
  ATTENDANCE_DEDUCTION_LINE_CODE_LATENESS,
  type AttendancePreviewMergeInput,
} from "@/lib/attendanceDeductionPayslipHelpers";
import { ListPaginationBar } from "@/components/ListPaginationBar";
import { DEFAULT_LIST_PAGE_SIZE } from "@/constants/pagination";
import { formatEmployeeName } from "@/lib/employeeName";
import { formatAppDate, formatAppMonthYear } from "@/lib/formatAppDate";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { formatRatioPercent, regimeResolvedLabel } from "@/lib/previsionalDisplay";

const meses = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function periodLabel(p: PayrollPeriod): string {
  return formatAppMonthYear(p.month, p.year);
}

function formatPen(amount: string | number): string {
  const n = typeof amount === "string" ? Number.parseFloat(amount) : amount;
  if (Number.isNaN(n)) return `S/ ${amount}`;
  return `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function installmentLineCodeForPlan(planId: number): string {
  return `installment:${planId}`;
}

function draftHasInstallmentForPlan(lines: DeductionLineDraft[], planId: number): boolean {
  return lines.some((l) => l.code === installmentLineCodeForPlan(planId));
}

function isPrevisionalDeductionCode(code: string): boolean {
  return code === "previsional" || code.startsWith("previsional_");
}

function draftHasPrevisionalLine(lines: DeductionLineDraft[]): boolean {
  return lines.some((l) => isPrevisionalDeductionCode(l.code));
}

function draftHasIncomeTaxLine(lines: DeductionLineDraft[]): boolean {
  return lines.some((l) => l.code === "income_tax" || l.code === "income_tax_5th");
}

function deductionPlanCategoryLabelEs(category: string | null | undefined): string {
  if (!category) return "";
  const m: Record<string, string> = {
    damage_equipment: "Daño a equipo",
    salary_advance: "Adelanto de sueldo",
    loan: "Préstamo",
    other: "Otro",
  };
  return m[category] ?? category;
}

function payrollMutationErrorMessage(err: unknown): string {
  if (err instanceof ApiHttpError) {
    const code = err.apiError?.code;
    if (code === "DUPLICATE_PAYROLL_PERIOD") {
      return "Ya existe un periodo de nómina para ese año y mes.";
    }
    if (code === "DUPLICATE_PAYSLIP") {
      return "Ya existe una boleta para este empleado en el periodo seleccionado.";
    }
    if (code === "PREVISIONAL_ASSIST_NOT_APPLICABLE") {
      return (
        err.apiError?.message ??
        "No se puede aplicar la asistencia previsional con el régimen o parámetros legales actuales."
      );
    }
    return err.apiError?.message ?? err.message;
  }
  return "No se pudo completar la operación.";
}

const payrollYears = Array.from({ length: 11 }, (_, i) => 2020 + i);

export default function PayrollPage() {
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const canGeneratePayroll = hasPermission("payroll.generate");
  const canExportPayrollSummary = hasPermission("reports.export") && hasPermission("payroll.view");
  const canSendPayslipNotification = hasPermission("payroll.send") && hasPermission("payroll.view");
  const payslipTableColSpan = canGeneratePayroll ? 6 : 5;
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [departmentsList, setDepartmentsList] = useState<Department[]>([]);
  const [employeesList, setEmployeesList] = useState<Employee[]>([]);
  const [areaFilter, setAreaFilter] = useState("all");
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [payslipsLoading, setPayslipsLoading] = useState(false);
  const [payslipsError, setPayslipsError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [payslipReloadKey, setPayslipReloadKey] = useState(0);
  const [payslipTablePage, setPayslipTablePage] = useState(1);
  const PAYROLL_TABLE_SIZE = DEFAULT_LIST_PAGE_SIZE;
  const [previsionalLoading, setPrevisionalLoading] = useState(false);
  const [previsionalError, setPrevisionalError] = useState<string | null>(null);
  const [previsionalData, setPrevisionalData] = useState<PrevisionalPreviewData | null>(null);

  const [periodDialogOpen, setPeriodDialogOpen] = useState(false);
  const [newPeriodYear, setNewPeriodYear] = useState(String(new Date().getFullYear()));
  const [newPeriodMonth, setNewPeriodMonth] = useState(String(new Date().getMonth() + 1));
  const [periodSaving, setPeriodSaving] = useState(false);

  const [payslipDialogOpen, setPayslipDialogOpen] = useState(false);
  const [payslipEmployeeId, setPayslipEmployeeId] = useState("");
  const [payslipGross, setPayslipGross] = useState("");
  const [payslipDeductions, setPayslipDeductions] = useState("");
  const [payslipNet, setPayslipNet] = useState("");
  const [payslipNetTouched, setPayslipNetTouched] = useState(false);
  const [payslipApplyPrevisional, setPayslipApplyPrevisional] = useState(false);
  const [payslipSaving, setPayslipSaving] = useState(false);
  const [payslipToDelete, setPayslipToDelete] = useState<Payslip | null>(null);
  const [payslipDeleteSaving, setPayslipDeleteSaving] = useState(false);

  const [payslipEditDialogOpen, setPayslipEditDialogOpen] = useState(false);
  const [editPayslipTarget, setEditPayslipTarget] = useState<Payslip | null>(null);
  const [editPayslipGross, setEditPayslipGross] = useState("");
  const [editPayslipDeductions, setEditPayslipDeductions] = useState("");
  const [editPayslipNet, setEditPayslipNet] = useState("");
  const [editPayslipNetTouched, setEditPayslipNetTouched] = useState(false);
  const [editPayslipSaving, setEditPayslipSaving] = useState(false);
  const [payrollExportBusy, setPayrollExportBusy] = useState<null | "xlsx" | "pdf">(null);
  const [payslipApproveBusy, setPayslipApproveBusy] = useState(false);
  const [payslipPdfBusy, setPayslipPdfBusy] = useState(false);
  const [payrollBulkNotifyBusy, setPayrollBulkNotifyBusy] = useState(false);
  const [payrollBulkZipBusy, setPayrollBulkZipBusy] = useState(false);

  const [createDeductionLines, setCreateDeductionLines] = useState<DeductionLineDraft[]>([]);
  const [editDeductionLines, setEditDeductionLines] = useState<DeductionLineDraft[]>([]);
  const [createInstallmentPlans, setCreateInstallmentPlans] = useState<DeductionInstallmentPlan[]>([]);
  const [editInstallmentPlans, setEditInstallmentPlans] = useState<DeductionInstallmentPlan[]>([]);
  const [attendancePreviewBusy, setAttendancePreviewBusy] = useState(false);
  const [editApplyPrevisionalBusy, setEditApplyPrevisionalBusy] = useState(false);
  const [newPlanLabel, setNewPlanLabel] = useState("");
  const [newPlanTotal, setNewPlanTotal] = useState("");
  const [newPlanMonths, setNewPlanMonths] = useState("");
  const [newPlanSaving, setNewPlanSaving] = useState(false);
  const [createPayslipPrevisional, setCreatePayslipPrevisional] = useState<PrevisionalPreviewData | null>(null);
  const [createPayslipPrevisionalLoading, setCreatePayslipPrevisionalLoading] = useState(false);
  const [editPayslipPrevisional, setEditPayslipPrevisional] = useState<PrevisionalPreviewData | null>(null);
  const [editPayslipPrevisionalLoading, setEditPayslipPrevisionalLoading] = useState(false);
  const [createAttendancePreview, setCreateAttendancePreview] = useState<AttendancePreviewMergeInput | null>(null);
  const [editAttendancePreview, setEditAttendancePreview] = useState<AttendancePreviewMergeInput | null>(null);
  const [createIncomeTaxFifthPreview, setCreateIncomeTaxFifthPreview] = useState<IncomeTaxFifthPreviewData | null>(null);
  const [createIncomeTaxFifthLoading, setCreateIncomeTaxFifthLoading] = useState(false);
  const [editIncomeTaxFifthPreview, setEditIncomeTaxFifthPreview] = useState<IncomeTaxFifthPreviewData | null>(null);
  const [editIncomeTaxFifthLoading, setEditIncomeTaxFifthLoading] = useState(false);

  const employeeById = useMemo(() => {
    const m: Record<number, Employee> = {};
    employeesList.forEach((e) => {
      m[e.id] = e;
    });
    return m;
  }, [employeesList]);

  const deptById = useMemo(() => {
    const m: Record<number, string> = {};
    departmentsList.forEach((d) => {
      m[d.id] = d.name;
    });
    return m;
  }, [departmentsList]);

  const selectedPeriod = useMemo(
    () => periods.find((p) => String(p.id) === selectedPeriodId),
    [periods, selectedPeriodId],
  );

  const filteredPayslips = useMemo(() => {
    if (areaFilter === "all") return payslips;
    const deptId = Number(areaFilter);
    if (Number.isNaN(deptId)) return payslips;
    return payslips.filter((p) => {
      const emp = employeeById[p.employee_id];
      return emp?.department_id === deptId;
    });
  }, [payslips, areaFilter, employeeById]);

  useEffect(() => {
    setPayslipTablePage(1);
  }, [selectedPeriodId, areaFilter, payslipReloadKey]);

  const payslipTableLastPage = Math.max(1, Math.ceil(filteredPayslips.length / PAYROLL_TABLE_SIZE));

  const payslipTableRows = useMemo(() => {
    const start = (payslipTablePage - 1) * PAYROLL_TABLE_SIZE;
    return filteredPayslips.slice(start, start + PAYROLL_TABLE_SIZE);
  }, [filteredPayslips, payslipTablePage]);

  useEffect(() => {
    if (payslipTablePage > payslipTableLastPage) {
      setPayslipTablePage(Math.max(1, payslipTableLastPage));
    }
  }, [payslipTablePage, payslipTableLastPage]);

  const previewSlip =
    filteredPayslips.find((p) => p.id === previewId) ?? filteredPayslips[0] ?? null;

  const previewEmployee = previewSlip ? employeeById[previewSlip.employee_id] : null;

  const editPayslipPeriod = useMemo(() => {
    if (!editPayslipTarget) return null;
    return periods.find((x) => x.id === editPayslipTarget.payroll_period_id) ?? null;
  }, [editPayslipTarget, periods]);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const [perRes, depts, emps] = await Promise.all([
        fetchPayrollPeriods(),
        fetchDepartments(),
        fetchAllEmployees(),
      ]);
      setPeriods(perRes.data);
      setDepartmentsList(depts);
      setEmployeesList(emps);
      setSelectedPeriodId((prev) => {
        if (prev && perRes.data.some((p) => String(p.id) === prev)) return prev;
        return perRes.data[0] ? String(perRes.data[0].id) : "";
      });
    } catch (err) {
      const msg =
        err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo cargar catálogos de nómina";
      setCatalogError(typeof msg === "string" ? msg : "Error");
      setPeriods([]);
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  const refreshPeriodsList = useCallback(async (selectPeriodId?: number) => {
    const perRes = await fetchPayrollPeriods();
    setPeriods(perRes.data);
    setSelectedPeriodId((prev) => {
      if (selectPeriodId != null) {
        const idStr = String(selectPeriodId);
        return perRes.data.some((p) => String(p.id) === idStr) ? idStr : prev;
      }
      if (prev && perRes.data.some((p) => String(p.id) === prev)) return prev;
      return perRes.data[0] ? String(perRes.data[0].id) : "";
    });
  }, []);

  const handleOpenPeriodDialog = () => {
    const d = new Date();
    setNewPeriodYear(String(d.getFullYear()));
    setNewPeriodMonth(String(d.getMonth() + 1));
    setPeriodDialogOpen(true);
  };

  const handleCreatePeriod = async () => {
    const y = Number.parseInt(newPeriodYear, 10);
    const mo = Number.parseInt(newPeriodMonth, 10);
    if (Number.isNaN(y) || Number.isNaN(mo) || mo < 1 || mo > 12) {
      toast({ title: "Datos inválidos", description: "Revisa año y mes.", variant: "destructive" });
      return;
    }
    setPeriodSaving(true);
    try {
      const res = await createPayrollPeriod({ year: y, month: mo });
      await refreshPeriodsList(res.data.id);
      toast({
        title: "Periodo creado",
        description: `${periodLabel(res.data)}`,
      });
      setPeriodDialogOpen(false);
    } catch (err) {
      toast({
        title: "No se pudo crear el periodo",
        description: payrollMutationErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setPeriodSaving(false);
    }
  };

  const handleOpenPayslipDialog = () => {
    if (!selectedPeriodId) {
      toast({
        title: "Elige un periodo",
        description: "Crea o selecciona un periodo de nómina antes de agregar una boleta.",
        variant: "destructive",
      });
      return;
    }
    setPayslipEmployeeId("");
    setPayslipGross("");
    setPayslipDeductions("");
    setPayslipNet("");
    setPayslipNetTouched(false);
    setPayslipApplyPrevisional(false);
    setCreateDeductionLines([]);
    setCreateInstallmentPlans([]);
    setNewPlanLabel("");
    setNewPlanTotal("");
    setNewPlanMonths("");
    setCreateAttendancePreview(null);
    setPayslipDialogOpen(true);
  };

  const applyNetFromGrossDeductions = (grossStr: string, dedStr: string) => {
    const g = Number.parseFloat(grossStr.replace(",", ".")) || 0;
    const d = Number.parseFloat(dedStr.replace(",", ".")) || 0;
    setPayslipNet((g - d).toFixed(2));
  };

  const handlePayslipEmployeeChange = (value: string) => {
    setPayslipEmployeeId(value);
    setCreateDeductionLines([]);
    setCreateAttendancePreview(null);
    const id = Number.parseInt(value, 10);
    let grossStr = "";
    if (!Number.isNaN(id)) {
      const emp = employeeById[id];
      const raw = emp?.salary;
      if (raw != null && String(raw).trim() !== "") {
        const n = Number.parseFloat(String(raw).replace(",", "."));
        grossStr = Number.isNaN(n) ? "0.00" : n.toFixed(2);
      } else {
        grossStr = "0.00";
      }
      void fetchDeductionInstallmentPlans(id, { status: "active" })
        .then((r) => setCreateInstallmentPlans(r.data))
        .catch(() => setCreateInstallmentPlans([]));
    } else {
      setCreateInstallmentPlans([]);
    }
    setPayslipGross(grossStr);
  };

  useEffect(() => {
    const sum = sumDeductionLineAmounts(createDeductionLines);
    setPayslipDeductions(sum.toFixed(2));
    if (!payslipNetTouched) {
      applyNetFromGrossDeductions(payslipGross, sum.toFixed(2));
    }
  }, [createDeductionLines, payslipGross, payslipNetTouched]);

  useEffect(() => {
    if (!payslipDialogOpen || !payslipEmployeeId || !selectedPeriodId) {
      setCreatePayslipPrevisional(null);
      return;
    }
    const gross = Number.parseFloat(payslipGross.replace(",", ".")) || 0;
    if (gross <= 0) {
      setCreatePayslipPrevisional(null);
      return;
    }
    const empId = Number.parseInt(payslipEmployeeId, 10);
    if (Number.isNaN(empId)) {
      setCreatePayslipPrevisional(null);
      return;
    }
    let cancelled = false;
    setCreatePayslipPrevisionalLoading(true);
    fetchPrevisionalPreview({
      employee_id: empId,
      payroll_period_id: Number.parseInt(selectedPeriodId, 10),
      gross_amount: gross,
    })
      .then((r) => {
        if (!cancelled) setCreatePayslipPrevisional(r.data);
      })
      .catch(() => {
        if (!cancelled) setCreatePayslipPrevisional(null);
      })
      .finally(() => {
        if (!cancelled) setCreatePayslipPrevisionalLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [payslipDialogOpen, payslipEmployeeId, selectedPeriodId, payslipGross]);

  useEffect(() => {
    if (!payslipEditDialogOpen || !editPayslipTarget || !selectedPeriodId) {
      setEditPayslipPrevisional(null);
      return;
    }
    const gross = Number.parseFloat(editPayslipGross.replace(",", ".")) || 0;
    if (gross <= 0) {
      setEditPayslipPrevisional(null);
      return;
    }
    let cancelled = false;
    setEditPayslipPrevisionalLoading(true);
    fetchPrevisionalPreview({
      employee_id: editPayslipTarget.employee_id,
      payroll_period_id: Number.parseInt(selectedPeriodId, 10),
      gross_amount: gross,
    })
      .then((r) => {
        if (!cancelled) setEditPayslipPrevisional(r.data);
      })
      .catch(() => {
        if (!cancelled) setEditPayslipPrevisional(null);
      })
      .finally(() => {
        if (!cancelled) setEditPayslipPrevisionalLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [payslipEditDialogOpen, editPayslipTarget, selectedPeriodId, editPayslipGross]);

  useEffect(() => {
    if (!payslipDialogOpen || !selectedPeriodId) {
      setCreateIncomeTaxFifthPreview(null);
      return;
    }
    const gross = Number.parseFloat(payslipGross.replace(",", ".")) || 0;
    if (gross <= 0) {
      setCreateIncomeTaxFifthPreview(null);
      return;
    }
    const periodId = Number.parseInt(selectedPeriodId, 10);
    if (Number.isNaN(periodId)) {
      setCreateIncomeTaxFifthPreview(null);
      return;
    }
    let cancelled = false;
    setCreateIncomeTaxFifthLoading(true);
    fetchIncomeTaxFifthPreview({
      payroll_period_id: periodId,
      gross_amount: gross,
    })
      .then((r) => {
        if (!cancelled) setCreateIncomeTaxFifthPreview(r.data);
      })
      .catch(() => {
        if (!cancelled) setCreateIncomeTaxFifthPreview(null);
      })
      .finally(() => {
        if (!cancelled) setCreateIncomeTaxFifthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [payslipDialogOpen, selectedPeriodId, payslipGross]);

  useEffect(() => {
    if (!payslipEditDialogOpen || !editPayslipTarget || !selectedPeriodId) {
      setEditIncomeTaxFifthPreview(null);
      return;
    }
    const gross = Number.parseFloat(editPayslipGross.replace(",", ".")) || 0;
    if (gross <= 0) {
      setEditIncomeTaxFifthPreview(null);
      return;
    }
    const periodId = Number.parseInt(selectedPeriodId, 10);
    if (Number.isNaN(periodId)) {
      setEditIncomeTaxFifthPreview(null);
      return;
    }
    let cancelled = false;
    setEditIncomeTaxFifthLoading(true);
    fetchIncomeTaxFifthPreview({
      payroll_period_id: periodId,
      gross_amount: gross,
    })
      .then((r) => {
        if (!cancelled) setEditIncomeTaxFifthPreview(r.data);
      })
      .catch(() => {
        if (!cancelled) setEditIncomeTaxFifthPreview(null);
      })
      .finally(() => {
        if (!cancelled) setEditIncomeTaxFifthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [payslipEditDialogOpen, editPayslipTarget, selectedPeriodId, editPayslipGross]);

  const handlePayslipNetChange = (value: string) => {
    setPayslipNetTouched(true);
    setPayslipNet(value);
  };

  const handleCreatePayslip = async () => {
    if (!selectedPeriodId) {
      toast({ title: "Sin periodo", description: "Selecciona un periodo.", variant: "destructive" });
      return;
    }
    const empId = Number.parseInt(payslipEmployeeId, 10);
    if (Number.isNaN(empId)) {
      toast({ title: "Empleado requerido", description: "Selecciona un empleado.", variant: "destructive" });
      return;
    }
    const gross = Number.parseFloat(payslipGross.replace(",", ".")) || 0;
    const ded = Number.parseFloat(payslipDeductions.replace(",", ".")) || 0;
    const net = Number.parseFloat(payslipNet.replace(",", ".")) || 0;
    if (gross < 0 || ded < 0 || net < 0) {
      toast({ title: "Importes inválidos", description: "Los montos deben ser mayores o iguales a cero.", variant: "destructive" });
      return;
    }
    setPayslipSaving(true);
    try {
      const meta = buildPayslipBreakdownMeta(createDeductionLines);
      const res = await createPayslip({
        payroll_period_id: Number(selectedPeriodId),
        employee_id: empId,
        gross_amount: gross,
        deductions_amount: ded,
        net_amount: net,
        status: "pendiente",
        apply_previsional_assist: payslipApplyPrevisional,
        ...(meta ? { meta } : {}),
      });
      toast({ title: "Boleta creada", description: "El registro se guardó correctamente." });
      setPayslipDialogOpen(false);
      setPayslipReloadKey((k) => k + 1);
      setPreviewId(res.data.id);
    } catch (err) {
      toast({
        title: "No se pudo crear la boleta",
        description: payrollMutationErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setPayslipSaving(false);
    }
  };

  const applyEditNetFromGrossDeductions = (grossStr: string, dedStr: string) => {
    const g = Number.parseFloat(grossStr.replace(",", ".")) || 0;
    const d = Number.parseFloat(dedStr.replace(",", ".")) || 0;
    setEditPayslipNet((g - d).toFixed(2));
  };

  const handleOpenEditPayslip = (p: Payslip, e: MouseEvent) => {
    e.stopPropagation();
    setEditPayslipTarget(p);
    setEditPayslipGross(String(p.gross_amount));
    setEditPayslipDeductions(String(p.deductions_amount));
    setEditPayslipNet(String(p.net_amount));
    setEditPayslipNetTouched(false);
    const fromMeta = deductionLinesFromPayslipMeta(p.meta);
    const dedNum = Number.parseFloat(String(p.deductions_amount).replace(",", ".")) || 0;
    if (fromMeta.length === 0 && dedNum > 0) {
      setEditDeductionLines([
        newDeductionLine({
          code: "legacy_total",
          label: "Descuentos (sin desglose previo)",
          amount: dedNum.toFixed(2),
        }),
      ]);
    } else {
      setEditDeductionLines(fromMeta);
    }
    void fetchDeductionInstallmentPlans(p.employee_id, { status: "active" })
      .then((r) => setEditInstallmentPlans(r.data))
      .catch(() => setEditInstallmentPlans([]));
    setEditAttendancePreview(null);
    setPayslipEditDialogOpen(true);
  };

  const handleEditPayslipGrossChange = (value: string) => {
    setEditPayslipGross(value);
    if (!editPayslipNetTouched) {
      const sum = sumDeductionLineAmounts(editDeductionLines);
      applyEditNetFromGrossDeductions(value, sum.toFixed(2));
    }
  };

  useEffect(() => {
    if (!payslipEditDialogOpen || !editPayslipTarget) return;
    const sum = sumDeductionLineAmounts(editDeductionLines);
    setEditPayslipDeductions(sum.toFixed(2));
    if (!editPayslipNetTouched) {
      const g = Number.parseFloat(editPayslipGross.replace(",", ".")) || 0;
      setEditPayslipNet((g - sum).toFixed(2));
    }
  }, [editDeductionLines, editPayslipGross, editPayslipNetTouched, payslipEditDialogOpen, editPayslipTarget]);

  const handleEditPayslipNetChange = (value: string) => {
    setEditPayslipNetTouched(true);
    setEditPayslipNet(value);
  };

  const handleUpdatePayslip = async () => {
    if (!editPayslipTarget) return;
    const gross = Number.parseFloat(editPayslipGross.replace(",", ".")) || 0;
    const ded = Number.parseFloat(editPayslipDeductions.replace(",", ".")) || 0;
    const net = Number.parseFloat(editPayslipNet.replace(",", ".")) || 0;
    if (gross < 0 || ded < 0 || net < 0) {
      toast({ title: "Importes inválidos", description: "Los montos deben ser mayores o iguales a cero.", variant: "destructive" });
      return;
    }
    const payslipId = editPayslipTarget.id;
    setEditPayslipSaving(true);
    try {
      const prevMeta =
        editPayslipTarget.meta && typeof editPayslipTarget.meta === "object"
          ? { ...(editPayslipTarget.meta as Record<string, unknown>) }
          : {};
      const breakdown = buildPayslipBreakdownMeta(editDeductionLines);
      if (breakdown) {
        Object.assign(prevMeta, breakdown);
      } else {
        delete prevMeta.payslip_breakdown;
      }
      await updatePayslip(payslipId, {
        gross_amount: gross,
        deductions_amount: ded,
        net_amount: net,
        meta: prevMeta as Record<string, unknown>,
      });
      toast({ title: "Boleta actualizada", description: "Los importes se guardaron correctamente." });
      setPayslipEditDialogOpen(false);
      setEditPayslipTarget(null);
      setPayslipReloadKey((k) => k + 1);
      setPreviewId(payslipId);
    } catch (err) {
      toast({
        title: "No se pudo actualizar la boleta",
        description: payrollMutationErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setEditPayslipSaving(false);
    }
  };

  const appendInstallmentLine = (
    plan: DeductionInstallmentPlan,
    currentLines: DeductionLineDraft[],
    setLines: Dispatch<SetStateAction<DeductionLineDraft[]>>,
  ) => {
    if (draftHasInstallmentForPlan(currentLines, plan.id)) {
      toast({
        title: "Cuota ya en esta boleta",
        description:
          "Este plan ya tiene una línea de cuota en el desglose. Quita esa línea si quieres cambiar el monto o vuelve a intentarlo tras eliminarla.",
        variant: "destructive",
      });
      return;
    }
    const nextAmt = plan.next_installment_amount ?? plan.installment_amount;
    const nextNum = plan.next_installment_number ?? plan.installments_applied + 1;
    setLines([
      ...currentLines,
      newDeductionLine({
        code: installmentLineCodeForPlan(plan.id),
        label: `${plan.label} (cuota ${nextNum}/${plan.installment_count})`,
        amount: String(nextAmt),
      }),
    ]);
  };

  const handleCreateInstallmentPlan = async () => {
    const empId = Number.parseInt(payslipEmployeeId, 10);
    if (Number.isNaN(empId)) {
      toast({ title: "Empleado requerido", description: "Selecciona un empleado primero.", variant: "destructive" });
      return;
    }
    const total = Number.parseFloat(newPlanTotal.replace(",", ".")) || 0;
    const months = Number.parseInt(newPlanMonths, 10);
    if (total < 0.01 || months < 1) {
      toast({ title: "Datos inválidos", description: "Indica monto total y cantidad de meses.", variant: "destructive" });
      return;
    }
    setNewPlanSaving(true);
    try {
      const res = await createDeductionInstallmentPlan(empId, {
        label: newPlanLabel.trim() || "Préstamo / descuento",
        total_amount: total,
        installment_count: months,
      });
      setCreateInstallmentPlans((prev) => [res.data, ...prev]);
      setNewPlanLabel("");
      setNewPlanTotal("");
      setNewPlanMonths("");
      toast({ title: "Plan creado", description: "Puedes aplicar la cuota en esta boleta." });
    } catch (err) {
      toast({
        title: "No se pudo crear el plan",
        description: payrollMutationErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setNewPlanSaving(false);
    }
  };

  const handleCreateInstallmentPlanFromEdit = async () => {
    if (!editPayslipTarget) return;
    const empId = editPayslipTarget.employee_id;
    const total = Number.parseFloat(newPlanTotal.replace(",", ".")) || 0;
    const months = Number.parseInt(newPlanMonths, 10);
    if (total < 0.01 || months < 1) {
      toast({ title: "Datos inválidos", description: "Indica monto total y cantidad de meses.", variant: "destructive" });
      return;
    }
    setNewPlanSaving(true);
    try {
      const res = await createDeductionInstallmentPlan(empId, {
        label: newPlanLabel.trim() || "Préstamo / descuento",
        total_amount: total,
        installment_count: months,
      });
      setEditInstallmentPlans((prev) => [res.data, ...prev]);
      setNewPlanLabel("");
      setNewPlanTotal("");
      setNewPlanMonths("");
      toast({ title: "Plan creado", description: "Puedes aplicar la cuota en esta boleta." });
    } catch (err) {
      toast({
        title: "No se pudo crear el plan",
        description: payrollMutationErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setNewPlanSaving(false);
    }
  };

  const toastAttendancePreviewRefreshed = (data: AttendancePreviewMergeInput) => {
    if (!data.suggested_amounts_computed) {
      toast({ title: "Sin montos", description: "Se necesita bruto mayor a cero.", variant: "destructive" });
      return;
    }
    const hasAbs = data.suggested_deduction_absence > 0;
    const hasLat = data.suggested_deduction_lateness > 0;
    if (!hasAbs && !hasLat) {
      const hasInc = data.absence_days_unjustified > 0 || data.tardiness_events_unjustified > 0;
      toast({
        title: hasInc ? "Sin monto sugerido" : "Sin incidencias NJ",
        description: hasInc ? "No hay importe calculado para faltas o tardanzas en este preview." : "No hay líneas que añadir.",
      });
      return;
    }
    toast({ title: "Sugerencias actualizadas", description: "Usá Añadir línea en cada fila que corresponda." });
  };

  const handleFetchAttendancePreviewCreate = async () => {
    if (!selectedPeriodId || !payslipEmployeeId) {
      toast({ title: "Datos incompletos", description: "Selecciona empleado y periodo.", variant: "destructive" });
      return;
    }
    setAttendancePreviewBusy(true);
    try {
      const gross = Number.parseFloat(payslipGross.replace(",", ".")) || 0;
      const res = await previewAttendanceDeductions({
        employee_id: Number.parseInt(payslipEmployeeId, 10),
        payroll_period_id: Number(selectedPeriodId),
        gross_amount: gross,
      });
      setCreateAttendancePreview(res.data);
      toastAttendancePreviewRefreshed(res.data);
    } catch (err) {
      toast({
        title: "No se pudo calcular",
        description: payrollMutationErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setAttendancePreviewBusy(false);
    }
  };

  const handleFetchAttendancePreviewEdit = async () => {
    if (!editPayslipTarget || !selectedPeriodId) return;
    setAttendancePreviewBusy(true);
    try {
      const gross = Number.parseFloat(editPayslipGross.replace(",", ".")) || 0;
      const res = await previewAttendanceDeductions({
        employee_id: editPayslipTarget.employee_id,
        payroll_period_id: Number(selectedPeriodId),
        gross_amount: gross,
      });
      setEditAttendancePreview(res.data);
      toastAttendancePreviewRefreshed(res.data);
    } catch (err) {
      toast({
        title: "No se pudo calcular",
        description: payrollMutationErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setAttendancePreviewBusy(false);
    }
  };

  const handleAddAbsenceLineCreate = () => {
    if (!createAttendancePreview) {
      toast({ title: "Sin datos", description: "Pulsa «Actualizar sugerencias» antes.", variant: "destructive" });
      return;
    }
    const r = appendAbsenceSuggestionFromPreview(createDeductionLines, createAttendancePreview);
    if (!r.added) {
      if (createDeductionLines.some((l) => l.code === ATTENDANCE_DEDUCTION_LINE_CODE_ABSENCE)) {
        toast({ title: "Ya agregado", description: "Esta línea ya está en el desglose.", variant: "destructive" });
      } else {
        toast({ title: "No aplica", description: "No hay monto sugerido para faltas en el último preview." });
      }
      return;
    }
    setCreateDeductionLines(r.lines);
    toast({ title: "Línea añadida" });
  };

  const handleAddLatenessLineCreate = () => {
    if (!createAttendancePreview) {
      toast({ title: "Sin datos", description: "Pulsa «Actualizar sugerencias» antes.", variant: "destructive" });
      return;
    }
    const r = appendLatenessSuggestionFromPreview(createDeductionLines, createAttendancePreview);
    if (!r.added) {
      if (createDeductionLines.some((l) => l.code === ATTENDANCE_DEDUCTION_LINE_CODE_LATENESS)) {
        toast({ title: "Ya agregado", description: "Esta línea ya está en el desglose.", variant: "destructive" });
      } else {
        toast({ title: "No aplica", description: "No hay monto sugerido para tardanzas en el último preview." });
      }
      return;
    }
    setCreateDeductionLines(r.lines);
    toast({ title: "Línea añadida" });
  };

  const handleAddAbsenceLineEdit = () => {
    if (!editAttendancePreview) {
      toast({ title: "Sin datos", description: "Pulsa «Actualizar sugerencias» antes.", variant: "destructive" });
      return;
    }
    const r = appendAbsenceSuggestionFromPreview(editDeductionLines, editAttendancePreview);
    if (!r.added) {
      if (editDeductionLines.some((l) => l.code === ATTENDANCE_DEDUCTION_LINE_CODE_ABSENCE)) {
        toast({ title: "Ya agregado", description: "Esta línea ya está en el desglose.", variant: "destructive" });
      } else {
        toast({ title: "No aplica", description: "No hay monto sugerido para faltas en el último preview." });
      }
      return;
    }
    setEditDeductionLines(r.lines);
    toast({ title: "Línea añadida" });
  };

  const handleAddLatenessLineEdit = () => {
    if (!editAttendancePreview) {
      toast({ title: "Sin datos", description: "Pulsa «Actualizar sugerencias» antes.", variant: "destructive" });
      return;
    }
    const r = appendLatenessSuggestionFromPreview(editDeductionLines, editAttendancePreview);
    if (!r.added) {
      if (editDeductionLines.some((l) => l.code === ATTENDANCE_DEDUCTION_LINE_CODE_LATENESS)) {
        toast({ title: "Ya agregado", description: "Esta línea ya está en el desglose.", variant: "destructive" });
      } else {
        toast({ title: "No aplica", description: "No hay monto sugerido para tardanzas en el último preview." });
      }
      return;
    }
    setEditDeductionLines(r.lines);
    toast({ title: "Línea añadida" });
  };

  const handleAddIncomeTaxFifthLineCreate = () => {
    const d = createIncomeTaxFifthPreview;
    if (!d || d.status !== "ok" || !d.proposed_deduction_line) {
      toast({
        title: "Sin sugerencia",
        description:
          d?.status === "missing_uit"
            ? "No hay UIT vigente en parámetros legales para la fecha del período."
            : "No hay retención sugerida para estos datos.",
        variant: "destructive",
      });
      return;
    }
    if (draftHasIncomeTaxLine(createDeductionLines)) {
      toast({
        title: "Renta ya agregada",
        description: "Quitá la línea de renta en el desglose aplicado.",
        variant: "destructive",
      });
      return;
    }
    const pl = d.proposed_deduction_line;
    setCreateDeductionLines((prev) => [
      ...prev,
      newDeductionLine({
        code: pl.code,
        label: pl.label,
        amount: pl.amount.toFixed(2),
      }),
    ]);
    toast({ title: "Línea añadida", description: "Podés editar el importe antes de crear la boleta." });
  };

  const handleAddIncomeTaxFifthLineEdit = () => {
    const d = editIncomeTaxFifthPreview;
    if (!d || d.status !== "ok" || !d.proposed_deduction_line) {
      toast({
        title: "Sin sugerencia",
        description:
          d?.status === "missing_uit"
            ? "No hay UIT vigente en parámetros legales para la fecha del período."
            : "No hay retención sugerida para estos datos.",
        variant: "destructive",
      });
      return;
    }
    if (draftHasIncomeTaxLine(editDeductionLines)) {
      toast({
        title: "Renta ya agregada",
        description: "Quitá la línea de renta en el desglose aplicado.",
        variant: "destructive",
      });
      return;
    }
    const pl = d.proposed_deduction_line;
    setEditDeductionLines((prev) => [
      ...prev,
      newDeductionLine({
        code: pl.code,
        label: pl.label,
        amount: pl.amount.toFixed(2),
      }),
    ]);
    toast({ title: "Línea añadida", description: "Podés editar el importe antes de guardar." });
  };

  const handleAddPrevisionalLineCreate = () => {
    if (!createPayslipPrevisional || createPayslipPrevisional.status !== "ok" || !createPayslipPrevisional.proposed_deduction_line) {
      return;
    }
    if (draftHasPrevisionalLine(createDeductionLines)) {
      toast({
        title: "Ya hay AFP/ONP en el desglose",
        description: "Quitá la línea previsional existente antes de añadir otra.",
        variant: "destructive",
      });
      return;
    }
    const pl = createPayslipPrevisional.proposed_deduction_line;
    setCreateDeductionLines((prev) => [
      ...prev,
      newDeductionLine({
        code: pl.code,
        label: pl.label,
        amount: pl.amount.toFixed(2),
      }),
    ]);
    toast({ title: "Línea añadida", description: "Podés editar el importe en el desglose antes de crear la boleta." });
  };

  const handleAddPrevisionalLineEdit = () => {
    if (!editPayslipPrevisional || editPayslipPrevisional.status !== "ok" || !editPayslipPrevisional.proposed_deduction_line) {
      return;
    }
    if (draftHasPrevisionalLine(editDeductionLines)) {
      toast({
        title: "Ya hay AFP/ONP en el desglose",
        description: "Quitá la línea previsional existente antes de añadir otra.",
        variant: "destructive",
      });
      return;
    }
    const pl = editPayslipPrevisional.proposed_deduction_line;
    setEditDeductionLines((prev) => [
      ...prev,
      newDeductionLine({
        code: pl.code,
        label: pl.label,
        amount: pl.amount.toFixed(2),
      }),
    ]);
    toast({ title: "Línea añadida", description: "Podés editar el importe en el desglose antes de guardar." });
  };

  const handleApplyPrevisionalEdit = async () => {
    if (!editPayslipTarget) return;
    setEditApplyPrevisionalBusy(true);
    try {
      const r = await applyPrevisionalToPayslip(editPayslipTarget.id);
      setEditPayslipTarget(r.data);
      setEditDeductionLines(deductionLinesFromPayslipMeta(r.data.meta));
      setEditPayslipGross(String(r.data.gross_amount));
      setEditPayslipDeductions(String(r.data.deductions_amount));
      setEditPayslipNet(String(r.data.net_amount));
      setEditPayslipNetTouched(false);
      toast({ title: "Previsional aplicado", description: "Se actualizó la línea AFP/ONP en el desglose." });
    } catch (err) {
      toast({
        title: "No se pudo aplicar",
        description: payrollMutationErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setEditApplyPrevisionalBusy(false);
    }
  };

  const handleConfirmDeletePayslip = async () => {
    if (!payslipToDelete) return;
    const deletedId = payslipToDelete.id;
    setPayslipDeleteSaving(true);
    try {
      await deletePayslip(deletedId);
      toast({ title: "Boleta eliminada", description: "El registro se eliminó correctamente." });
      setPayslipToDelete(null);
      setPayslipReloadKey((k) => k + 1);
      if (previewId === deletedId) setPreviewId(null);
    } catch (err) {
      toast({
        title: "No se pudo eliminar",
        description: payrollMutationErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setPayslipDeleteSaving(false);
    }
  };

  const handlePayrollExportXlsx = async () => {
    if (!selectedPeriodId) {
      toast({ title: "Sin periodo", description: "Selecciona un periodo de nómina.", variant: "destructive" });
      return;
    }
    setPayrollExportBusy("xlsx");
    try {
      await downloadPayrollSummaryXlsx(Number(selectedPeriodId), areaFilter);
      toast({ title: "Exportación lista", description: "Se descargó el resumen en Excel." });
    } catch (err) {
      toast({
        title: "No se pudo exportar",
        description: payrollMutationErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setPayrollExportBusy(null);
    }
  };

  const handleDownloadPayslipPdf = async () => {
    if (!previewSlip) return;
    setPayslipPdfBusy(true);
    try {
      await downloadPayslipPdf(previewSlip.id);
      toast({ title: "PDF generado", description: "La descarga de la boleta se inició." });
    } catch (err) {
      toast({
        title: "No se pudo generar el PDF",
        description: payrollMutationErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setPayslipPdfBusy(false);
    }
  };

  const handleNotifyPayslipsForPeriod = async () => {
    if (!selectedPeriodId) {
      toast({ title: "Sin periodo", description: "Selecciona un periodo de nómina.", variant: "destructive" });
      return;
    }
    setPayrollBulkNotifyBusy(true);
    try {
      const res = await notifyPayslipsForPeriod(Number(selectedPeriodId), areaFilter);
      const n = res.data.notified_count;
      toast({
        title: "Notificaciones registradas",
        description:
          n === 0
            ? "No hay boletas en el alcance seleccionado (período y filtro de área)."
            : `Se registraron ${n} notificación${n === 1 ? "" : "es"} en el portal.`,
      });
    } catch (err) {
      toast({
        title: "No se pudieron enviar las notificaciones",
        description: payrollMutationErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setPayrollBulkNotifyBusy(false);
    }
  };

  const handlePayrollBulkZipDownload = async () => {
    if (!selectedPeriodId) {
      toast({ title: "Sin periodo", description: "Selecciona un periodo de nómina.", variant: "destructive" });
      return;
    }
    setPayrollBulkZipBusy(true);
    try {
      await downloadPayrollPayslipsZip(Number(selectedPeriodId), areaFilter);
      toast({
        title: "Descarga lista",
        description: "Se generó el ZIP con los PDF de boleta del alcance seleccionado.",
      });
    } catch (err) {
      toast({
        title: "No se pudo generar el ZIP",
        description: payrollMutationErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setPayrollBulkZipBusy(false);
    }
  };

  const handleApprovePayslip = async () => {
    if (!previewSlip) return;
    setPayslipApproveBusy(true);
    try {
      const res = await approvePayslip(previewSlip.id);
      toast({
        title: "Boleta aprobada",
        description: "El empleado podrá verla en su portal y se registró la notificación correspondiente.",
      });
      setPayslipReloadKey((k) => k + 1);
      setPreviewId(res.data.id);
    } catch (err) {
      toast({
        title: "No se pudo aprobar la boleta",
        description: payrollMutationErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setPayslipApproveBusy(false);
    }
  };

  const handlePayrollExportPdf = async () => {
    if (!selectedPeriodId) {
      toast({ title: "Sin periodo", description: "Selecciona un periodo de nómina.", variant: "destructive" });
      return;
    }
    setPayrollExportBusy("pdf");
    try {
      await downloadPayrollSummaryPdf(Number(selectedPeriodId), areaFilter);
      toast({ title: "Exportación lista", description: "Se descargó el resumen en PDF." });
    } catch (err) {
      toast({
        title: "No se pudo exportar",
        description: payrollMutationErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setPayrollExportBusy(null);
    }
  };

  const payrollExportDisabledReason = !canExportPayrollSummary
    ? "Requiere permisos de exportación de reportes y ver nómina"
    : !selectedPeriodId
      ? "Selecciona un periodo"
      : undefined;

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    setPreviewId(null);
  }, [selectedPeriodId]);

  useEffect(() => {
    if (!selectedPeriodId) {
      setPayslips([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setPayslipsLoading(true);
      setPayslipsError(null);
      try {
        const allSlips = await fetchAllPayslipsForPeriod(Number(selectedPeriodId));
        if (!cancelled) setPayslips(allSlips);
      } catch (err) {
        if (!cancelled) {
          const msg =
            err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudieron cargar las boletas";
          setPayslipsError(typeof msg === "string" ? msg : "Error");
          setPayslips([]);
        }
      } finally {
        if (!cancelled) setPayslipsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPeriodId, payslipReloadKey]);

  useEffect(() => {
    if (previewId != null && !filteredPayslips.some((p) => p.id === previewId)) {
      setPreviewId(null);
    }
  }, [filteredPayslips, previewId]);

  useEffect(() => {
    if (!previewSlip?.id || !selectedPeriodId) {
      setPrevisionalData(null);
      setPrevisionalError(null);
      return;
    }
    const slip = previewSlip;
    let cancelled = false;
    (async () => {
      setPrevisionalLoading(true);
      setPrevisionalError(null);
      try {
        const gross = Number.parseFloat(String(slip.gross_amount));
        const r = await fetchPrevisionalPreview({
          employee_id: slip.employee_id,
          payroll_period_id: Number(selectedPeriodId),
          gross_amount: Number.isNaN(gross) ? 0 : gross,
        });
        if (!cancelled) setPrevisionalData(r.data);
      } catch (err) {
        if (!cancelled) {
          const msg =
            err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo cargar la sugerencia previsional";
          setPrevisionalError(typeof msg === "string" ? msg : "Error");
          setPrevisionalData(null);
        }
      } finally {
        if (!cancelled) setPrevisionalLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    previewSlip?.id,
    previewSlip?.employee_id,
    previewSlip?.gross_amount,
    selectedPeriodId,
  ]);

  const periodTitle = selectedPeriod ? periodLabel(selectedPeriod) : "—";

  if (catalogLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold">Boletas y Nómina</h1>
          <p className="text-sm text-muted-foreground mt-2">Cargando…</p>
        </div>
      </div>
    );
  }

  if (catalogError) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold">Boletas y Nómina</h1>
          <p className="text-sm text-destructive mt-2">{catalogError}</p>
          <Button variant="outline" size="sm" className="mt-3" type="button" onClick={() => void loadCatalog()}>
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Boletas y Nómina</h1>
          <p className="text-muted-foreground text-sm mt-1">Gestión de boletas de pago y planilla mensual</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            type="button"
            disabled={
              !selectedPeriodId || !canExportPayrollSummary || payrollBulkZipBusy || payrollExportBusy !== null
            }
            title={
              payrollBulkZipBusy || canExportPayrollSummary
                ? payrollExportBusy !== null
                  ? "Espera a que termine la exportación en curso"
                  : undefined
                : "Requiere permisos de exportación de reportes y ver nómina"
            }
            onClick={() => void handlePayrollBulkZipDownload()}
          >
            <Download className="w-4 h-4" />
            {payrollBulkZipBusy ? "Generando ZIP…" : "Descarga Masiva"}
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            type="button"
            disabled={
              !selectedPeriodId || !canSendPayslipNotification || payrollBulkNotifyBusy
            }
            title={
              payrollBulkNotifyBusy || canSendPayslipNotification
                ? undefined
                : "Requiere permisos de envío de nómina y ver nómina"
            }
            onClick={() => void handleNotifyPayslipsForPeriod()}
          >
            <Send className="w-4 h-4" />
            {payrollBulkNotifyBusy ? "Enviando…" : "Enviar Notificaciones"}
          </Button>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap items-center">
        <Select value={selectedPeriodId} onValueChange={setSelectedPeriodId} disabled={periods.length === 0}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Periodo" />
          </SelectTrigger>
          <SelectContent>
            {periods.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {periodLabel(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={areaFilter} onValueChange={setAreaFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Área" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las áreas</SelectItem>
            {departmentsList.map((d) => (
              <SelectItem key={d.id} value={String(d.id)}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canGeneratePayroll ? (
          <>
            <Button type="button" size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={handleOpenPeriodDialog}>
              <Plus className="w-4 h-4" />
              Nuevo período
            </Button>
            <Button
              type="button"
              size="sm"
              variant="default"
              className="gap-1.5 shrink-0"
              disabled={!selectedPeriodId}
              onClick={handleOpenPayslipDialog}
            >
              <Plus className="w-4 h-4" />
              Nueva boleta
            </Button>
          </>
        ) : null}
      </div>

      {periods.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay periodos de nómina registrados en el sistema.</p>
      ) : null}

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">
            {previewSlip && previewEmployee
              ? `Vista Previa de Boleta — ${formatEmployeeName(previewEmployee)}`
              : "Vista Previa de Boleta"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {payslipsLoading ? (
            <p className="text-sm text-muted-foreground">Cargando boletas…</p>
          ) : payslipsError ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">{payslipsError}</p>
              <Button variant="outline" size="sm" type="button" onClick={() => setPayslipReloadKey((k) => k + 1)}>
                Reintentar
              </Button>
            </div>
          ) : !previewSlip ? (
            <p className="text-sm text-muted-foreground">
              No hay boletas para este periodo{areaFilter !== "all" ? " y filtro de área" : ""}. Selecciona una fila en el
              resumen cuando existan registros.
            </p>
          ) : (
            <>
              <div className="border border-border rounded-lg p-5 space-y-4">
                <div className="flex justify-between">
                  <div>
                    <p className="font-bold">EnviaMas S.A.C.</p>
                    <p className="text-xs text-muted-foreground">RUC: 20123456789</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">Boleta de Pago</p>
                    <p className="text-xs text-muted-foreground">Periodo: {periodTitle}</p>
                  </div>
                </div>
                <Separator />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  {[
                    ["Empleado", previewEmployee ? formatEmployeeName(previewEmployee) : `#${previewSlip.employee_id}`],
                    ["DNI", previewEmployee?.dni ?? "—"],
                    ["Área", previewEmployee?.department_id != null ? (deptById[previewEmployee.department_id] ?? "—") : "—"],
                    ["Puesto", previewEmployee?.position ?? "—"],
                  ].map(([l, v]) => (
                    <div key={l}>
                      <p className="text-muted-foreground text-xs">{l}</p>
                      <p className="font-medium">{v}</p>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-xs text-muted-foreground">Estado boleta</span>
                  <Badge
                    variant={previewSlip.status === "aprobada" ? "default" : "secondary"}
                    className={cn(
                      "text-xs font-medium border",
                      previewSlip.status === "aprobada" &&
                        "bg-emerald-600 hover:bg-emerald-600 text-white border-emerald-600",
                      previewSlip.status === "pendiente" &&
                        "bg-amber-100 text-amber-950 border-amber-200 dark:bg-amber-950 dark:text-amber-50 dark:border-amber-800",
                    )}
                  >
                    {previewSlip.status === "aprobada"
                      ? "Aprobada"
                      : previewSlip.status === "pendiente"
                        ? "Pendiente"
                        : previewSlip.status}
                  </Badge>
                </div>
                <Separator />
                <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5 space-y-2">
                  <p className="text-xs font-semibold text-foreground">Sugerencia previsional (referencia)</p>
                  <p className="text-xs text-muted-foreground">
                    Cálculo asistido según parámetros legales vigentes; no modifica los importes guardados de la boleta.
                  </p>
                  {previsionalLoading ? (
                    <p className="text-xs text-muted-foreground">Cargando sugerencia…</p>
                  ) : previsionalError ? (
                    <div className="space-y-1.5">
                      <p className="text-xs text-destructive">{previsionalError}</p>
                    </div>
                  ) : previsionalData == null ? (
                    <p className="text-xs text-muted-foreground">—</p>
                  ) : previsionalData.status === "unsupported_regime" ? (
                    <p className="text-xs text-amber-800 dark:text-amber-200/90">
                      Régimen no soportado para cálculo automático
                      {previsionalData.pension_fund_original != null && previsionalData.pension_fund_original !== ""
                        ? ` (${previsionalData.pension_fund_original})`
                        : ""}
                      . Revise la ficha del empleado o cargue la boleta manualmente.
                    </p>
                  ) : previsionalData.status === "missing_legal_rate" ? (
                    <p className="text-xs text-amber-800 dark:text-amber-200/90">
                      No hay tasa legal configurada para la fecha de referencia{" "}
                      {formatAppDate(previsionalData.reference_date)}.
                      {previsionalData.legal_parameter_key != null ? ` (${previsionalData.legal_parameter_key})` : ""}
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                      <div>
                        <span className="text-muted-foreground">Régimen detectado</span>
                        <p className="font-medium">{regimeResolvedLabel(previsionalData.regime_resolved)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Tasa aplicada</span>
                        <p className="font-medium">{formatRatioPercent(previsionalData.ratio)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Base (bruto boleta)</span>
                        <p className="font-medium">{formatPen(previsionalData.base_amount)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Monto sugerido</span>
                        <p className="font-medium text-destructive">
                          {previsionalData.amount != null ? formatPen(previsionalData.amount) : "—"}
                        </p>
                      </div>
                      <div className="sm:col-span-2">
                        <span className="text-muted-foreground">Fecha referencia legal</span>
                        <p className="font-medium">{formatAppDate(previsionalData.reference_date)}</p>
                      </div>
                    </div>
                  )}
                </div>
                <Separator />
                <p className="text-xs text-muted-foreground">
                  Los importes de la boleta son los registrados en el sistema; el desglose detallado depende de
                  meta.payslip_breakdown cuando exista.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <p className="text-sm font-semibold mb-2">Ingresos</p>
                    <div className="flex justify-between text-sm py-1">
                      <span className="text-muted-foreground">Importe bruto</span>
                      <span>{formatPen(previewSlip.gross_amount)}</span>
                    </div>
                    <div className="flex justify-between text-sm py-1 font-semibold border-t border-border mt-1 pt-1">
                      <span>Total</span>
                      <span>{formatPen(previewSlip.gross_amount)}</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-semibold mb-2">Descuentos</p>
                    {(() => {
                      const m = previewSlip.meta as Record<string, unknown> | null | undefined;
                      const pb = m?.payslip_breakdown as { deductions?: { label: string; amount: number }[] } | undefined;
                      const rows = pb?.deductions;
                      return Array.isArray(rows) && rows.length > 0 ? (
                        <ul className="text-xs space-y-1 mb-2 border-b border-border pb-2">
                          {rows.map((r, i) => (
                            <li key={i} className="flex justify-between gap-2">
                              <span className="text-muted-foreground truncate">{r.label}</span>
                              <span className="text-destructive shrink-0">{formatPen(String(r.amount))}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null;
                    })()}
                    <div className="flex justify-between text-sm py-1">
                      <span className="text-muted-foreground">Total descuentos</span>
                      <span className="text-destructive">{formatPen(previewSlip.deductions_amount)}</span>
                    </div>
                    <div className="flex justify-between text-sm py-1 font-semibold border-t border-border mt-1 pt-1">
                      <span>Total</span>
                      <span className="text-destructive">{formatPen(previewSlip.deductions_amount)}</span>
                    </div>
                  </div>
                </div>
                <Separator />
                <div className="flex justify-between text-lg font-bold">
                  <span>Neto a Pagar</span>
                  <span className="text-primary">{formatPen(previewSlip.net_amount)}</span>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <Button
                  size="sm"
                  className="gap-1.5"
                  type="button"
                  disabled={!previewSlip || !canExportPayrollSummary || payslipPdfBusy}
                  title={
                    payslipPdfBusy || canExportPayrollSummary
                      ? undefined
                      : "Requiere permisos de exportación de reportes y ver nómina"
                  }
                  onClick={() => void handleDownloadPayslipPdf()}
                >
                  <FileText className="w-4 h-4" />
                  {payslipPdfBusy ? "Generando…" : "Generar PDF"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-emerald-600/40 text-emerald-800 hover:bg-emerald-50 dark:text-emerald-100 dark:hover:bg-emerald-950/40"
                  type="button"
                  disabled={
                    !previewSlip ||
                    !canGeneratePayroll ||
                    payslipApproveBusy ||
                    previewSlip.status === "aprobada"
                  }
                  title={
                    previewSlip?.status === "aprobada"
                      ? "Esta boleta ya está aprobada"
                      : !canGeneratePayroll
                        ? "Requiere permiso para generar nómina"
                        : undefined
                  }
                  onClick={() => void handleApprovePayslip()}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {payslipApproveBusy ? "Aprobando…" : "Aprobar boleta"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Resumen de Nómina — {periodTitle}</CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              type="button"
              disabled={Boolean(payrollExportDisabledReason) || payrollExportBusy !== null}
              title={payrollExportBusy !== null ? undefined : payrollExportDisabledReason}
              onClick={() => void handlePayrollExportXlsx()}
            >
              <Download className="w-3.5 h-3.5" />
              {payrollExportBusy === "xlsx" ? "Generando…" : "Excel"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              type="button"
              disabled={Boolean(payrollExportDisabledReason) || payrollExportBusy !== null}
              title={payrollExportBusy !== null ? undefined : payrollExportDisabledReason}
              onClick={() => void handlePayrollExportPdf()}
            >
              <FileText className="w-3.5 h-3.5" />
              {payrollExportBusy === "pdf" ? "Generando…" : "PDF"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Empleado</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Área</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-5 py-3">Bruto</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-5 py-3">Descuentos</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-5 py-3">Neto</th>
                {canGeneratePayroll ? (
                  <th className="text-right text-xs font-semibold text-muted-foreground px-5 py-3 w-[1%] whitespace-nowrap">
                    Acciones
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {payslipsLoading ? (
                <tr>
                  <td colSpan={payslipTableColSpan} className="px-5 py-8 text-center text-sm text-muted-foreground">
                    Cargando boletas…
                  </td>
                </tr>
              ) : payslipsError ? (
                <tr>
                  <td colSpan={payslipTableColSpan} className="px-5 py-8 text-center">
                    <p className="text-sm text-destructive mb-2">{payslipsError}</p>
                    <Button variant="outline" size="sm" type="button" onClick={() => setPayslipReloadKey((k) => k + 1)}>
                      Reintentar
                    </Button>
                  </td>
                </tr>
              ) : filteredPayslips.length === 0 ? (
                <tr>
                  <td colSpan={payslipTableColSpan} className="px-5 py-8 text-center text-sm text-muted-foreground">
                    No hay boletas para mostrar.
                  </td>
                </tr>
              ) : (
                payslipTableRows.map((p) => {
                  const emp = employeeById[p.employee_id];
                  const area =
                    emp?.department_id != null ? (deptById[emp.department_id] ?? "—") : "—";
                  const name = emp ? formatEmployeeName(emp) : `#${p.employee_id}`;
                  const sel = previewSlip?.id === p.id;
                  return (
                    <tr
                      key={p.id}
                      className={cn("border-b border-border last:border-0 cursor-pointer hover:bg-muted/30", sel && "bg-muted/40")}
                      onClick={() => setPreviewId(p.id)}
                    >
                      <td className="px-5 py-3 text-sm font-medium">{name}</td>
                      <td className="px-5 py-3 text-sm">{area}</td>
                      <td className="px-5 py-3 text-sm text-right">{formatPen(p.gross_amount)}</td>
                      <td className="px-5 py-3 text-sm text-right text-destructive">{formatPen(p.deductions_amount)}</td>
                      <td className="px-5 py-3 text-sm text-right font-semibold">{formatPen(p.net_amount)}</td>
                      {canGeneratePayroll ? (
                        <td
                          className="px-5 py-3 text-sm text-right align-middle"
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          <div className="inline-flex flex-wrap gap-2 justify-end">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="gap-1.5"
                              onClick={(e) => handleOpenEditPayslip(p, e)}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              Editar
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPayslipToDelete(p);
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Eliminar
                            </Button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          {!payslipsLoading && !payslipsError ? (
            <ListPaginationBar
              page={Math.min(payslipTablePage, payslipTableLastPage)}
              lastPage={payslipTableLastPage}
              total={filteredPayslips.length}
              pageSize={PAYROLL_TABLE_SIZE}
              onPageChange={setPayslipTablePage}
            />
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={periodDialogOpen} onOpenChange={setPeriodDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo período de nómina</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">Define el año y mes del periodo. No puede duplicarse un mismo año/mes.</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pp-year">Año</Label>
                <Select value={newPeriodYear} onValueChange={setNewPeriodYear}>
                  <SelectTrigger id="pp-year">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {payrollYears.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pp-month">Mes</Label>
                <Select value={newPeriodMonth} onValueChange={setNewPeriodMonth}>
                  <SelectTrigger id="pp-month">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {meses.map((label, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPeriodDialogOpen(false)} disabled={periodSaving}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleCreatePeriod()} disabled={periodSaving}>
              {periodSaving ? "Creando…" : "Crear período"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={payslipDialogOpen} onOpenChange={setPayslipDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nueva boleta</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {selectedPeriod ? (
              <p className="text-sm text-muted-foreground">
                Periodo: <span className="font-medium text-foreground">{periodLabel(selectedPeriod)}</span>
              </p>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="ps-emp">Empleado</Label>
              <Select value={payslipEmployeeId} onValueChange={handlePayslipEmployeeChange}>
                <SelectTrigger id="ps-emp">
                  <SelectValue placeholder="Seleccionar empleado" />
                </SelectTrigger>
                <SelectContent>
                  {employeesList.map((e) => (
                    <SelectItem key={e.id} value={String(e.id)}>
                      {formatEmployeeName(e)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ps-gross">Bruto</Label>
                <Input
                  id="ps-gross"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  placeholder={payslipEmployeeId ? "0.00" : "—"}
                  value={payslipGross}
                  disabled
                  className="bg-muted cursor-not-allowed"
                  title="Tomado del sueldo del perfil del empleado"
                />
                <p className="text-xs text-muted-foreground">
                  {payslipEmployeeId
                    ? "Importe bruto según el sueldo registrado en el perfil del empleado; no se puede editar aquí."
                    : "Selecciona un empleado para cargar el bruto desde su perfil."}
                </p>
              </div>
              <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Descuentos (desglose)</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Selecciona las líneas que deseas aplicar. Podrás editar los importes antes de crear la boleta.
                </p>

                {!payslipEmployeeId ? (
                  <p className="text-sm text-muted-foreground">Selecciona un empleado para ver descuentos disponibles.</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-foreground">Descuentos disponibles</span>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="h-8 text-xs"
                          disabled={!selectedPeriodId || attendancePreviewBusy}
                          title="Obtiene montos sugeridos de faltas y tardanzas sin añadirlos al desglose."
                          onClick={() => void handleFetchAttendancePreviewCreate()}
                        >
                          {attendancePreviewBusy ? "…" : "Actualizar sugerencias"}
                        </Button>
                        <Link
                          to={`/descuentos?employee=${payslipEmployeeId}`}
                          className="text-xs text-primary underline inline-flex items-center gap-1"
                        >
                          Gestionar <ExternalLink className="w-3 h-3" />
                        </Link>
                      </div>
                    </div>

                    <div className="overflow-x-auto rounded border border-border/60">
                      <table className="w-full text-xs min-w-[520px]">
                        <thead>
                          <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                            <th className="p-2 font-medium w-[14%]">Origen</th>
                            <th className="p-2 font-medium w-[18%]">Concepto</th>
                            <th className="p-2 font-medium min-w-[120px]">Detalle</th>
                            <th className="p-2 font-medium text-right w-[14%] whitespace-nowrap">Monto sugerido</th>
                            <th className="p-2 font-medium text-right w-[22%]">Acción</th>
                          </tr>
                        </thead>
                        <tbody className="text-foreground">
                          <tr className="border-b border-border/50 align-top">
                            <td className="p-2">Asistencia</td>
                            <td className="p-2">Faltas no justif.</td>
                            <td className="p-2 text-muted-foreground break-words max-w-[200px]">
                              {createAttendancePreview
                                ? `${createAttendancePreview.absence_days_unjustified} días NJ`
                                : "—"}
                            </td>
                            <td className="p-2 text-right tabular-nums">
                              {createAttendancePreview?.suggested_amounts_computed
                                ? createAttendancePreview.suggested_deduction_absence > 0
                                  ? formatPen(createAttendancePreview.suggested_deduction_absence)
                                  : "—"
                                : createAttendancePreview
                                  ? "Requiere bruto"
                                  : "—"}
                            </td>
                            <td className="p-2 text-right">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={
                                  !selectedPeriodId ||
                                  createDeductionLines.some((l) => l.code === ATTENDANCE_DEDUCTION_LINE_CODE_ABSENCE) ||
                                  !createAttendancePreview?.suggested_amounts_computed ||
                                  (createAttendancePreview?.suggested_deduction_absence ?? 0) <= 0
                                }
                                title={
                                  !createAttendancePreview
                                    ? "Pulsa Actualizar sugerencias primero."
                                    : "Añade una línea absence_suggested al desglose."
                                }
                                onClick={() => void handleAddAbsenceLineCreate()}
                              >
                                {createDeductionLines.some((l) => l.code === ATTENDANCE_DEDUCTION_LINE_CODE_ABSENCE)
                                  ? "Ya agregado"
                                  : "Añadir línea"}
                              </Button>
                            </td>
                          </tr>
                          <tr className="border-b border-border/50 align-top">
                            <td className="p-2">Asistencia</td>
                            <td className="p-2">Tardanzas no justif.</td>
                            <td className="p-2 text-muted-foreground break-words max-w-[200px]">
                              {createAttendancePreview
                                ? `${createAttendancePreview.tardiness_events_unjustified} eventos NJ`
                                : "—"}
                            </td>
                            <td className="p-2 text-right tabular-nums">
                              {createAttendancePreview?.suggested_amounts_computed
                                ? createAttendancePreview.suggested_deduction_lateness > 0
                                  ? formatPen(createAttendancePreview.suggested_deduction_lateness)
                                  : "—"
                                : createAttendancePreview
                                  ? "Requiere bruto"
                                  : "—"}
                            </td>
                            <td className="p-2 text-right">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={
                                  !selectedPeriodId ||
                                  createDeductionLines.some((l) => l.code === ATTENDANCE_DEDUCTION_LINE_CODE_LATENESS) ||
                                  !createAttendancePreview?.suggested_amounts_computed ||
                                  (createAttendancePreview?.suggested_deduction_lateness ?? 0) <= 0
                                }
                                title={
                                  !createAttendancePreview
                                    ? "Pulsa Actualizar sugerencias primero."
                                    : "Añade una línea lateness_suggested al desglose."
                                }
                                onClick={() => void handleAddLatenessLineCreate()}
                              >
                                {createDeductionLines.some((l) => l.code === ATTENDANCE_DEDUCTION_LINE_CODE_LATENESS)
                                  ? "Ya agregado"
                                  : "Añadir línea"}
                              </Button>
                            </td>
                          </tr>
                          <tr className="border-b border-border/50 align-top">
                            <td className="p-2">Previsional</td>
                            <td className="p-2">AFP / ONP</td>
                            <td className="p-2 text-muted-foreground break-words">
                              {createPayslipPrevisionalLoading ? (
                                "…"
                              ) : !payslipEmployeeId || Number.parseFloat(payslipGross.replace(",", ".")) <= 0 ? (
                                "Requiere bruto"
                              ) : createPayslipPrevisional?.status === "unsupported_regime" ? (
                                <span className="text-amber-800 dark:text-amber-200/90">Régimen no soportado</span>
                              ) : createPayslipPrevisional?.status === "missing_legal_rate" ? (
                                <span className="text-amber-800 dark:text-amber-200/90">
                                  Sin tasa {formatAppDate(createPayslipPrevisional.reference_date)}
                                </span>
                              ) : createPayslipPrevisional?.status === "ok" ? (
                                <>
                                  {regimeResolvedLabel(createPayslipPrevisional.regime_resolved)} ·{" "}
                                  {formatRatioPercent(createPayslipPrevisional.ratio)}
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="p-2 text-right tabular-nums text-destructive font-medium">
                              {createPayslipPrevisional?.status === "ok" && createPayslipPrevisional.amount != null
                                ? formatPen(createPayslipPrevisional.amount)
                                : "—"}
                            </td>
                            <td className="p-2 text-right">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={
                                  createPayslipPrevisional?.status !== "ok" ||
                                  !createPayslipPrevisional.proposed_deduction_line ||
                                  draftHasPrevisionalLine(createDeductionLines)
                                }
                                onClick={() => void handleAddPrevisionalLineCreate()}
                              >
                                {draftHasPrevisionalLine(createDeductionLines) ? "Ya agregado" : "Añadir línea"}
                              </Button>
                            </td>
                          </tr>
                          {createInstallmentPlans.map((pl) => {
                            const already = draftHasInstallmentForPlan(createDeductionLines, pl.id);
                            const nextAmt = pl.next_installment_amount ?? pl.installment_amount;
                            const nextNum = pl.next_installment_number ?? pl.installments_applied + 1;
                            const cat = deductionPlanCategoryLabelEs(pl.category);
                            return (
                              <tr key={pl.id} className="border-b border-border/50 align-top">
                                <td className="p-2">Plan cuotas</td>
                                <td className="p-2 break-words">{pl.label}</td>
                                <td className="p-2 text-muted-foreground break-words max-w-[200px]">
                                  {[cat, pl.description?.trim()].filter(Boolean).join(" · ") || "—"}
                                  <span className="block text-[11px] mt-0.5">
                                    Cuota {nextNum}/{pl.installment_count} · Pend. {formatPen(pl.remaining_total_amount)}
                                  </span>
                                </td>
                                <td className="p-2 text-right tabular-nums">{formatPen(nextAmt)}</td>
                                <td className="p-2 text-right">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    disabled={already}
                                    onClick={() => appendInstallmentLine(pl, createDeductionLines, setCreateDeductionLines)}
                                  >
                                    {already ? "Ya agregado" : "Añadir línea"}
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                          <tr className="border-b border-border/50 align-top">
                            <td className="p-2">Renta</td>
                            <td className="p-2">Impuesto a la renta 5ta categoría</td>
                            <td className="p-2 text-muted-foreground break-words text-[11px] max-w-[220px]">
                              {createIncomeTaxFifthLoading ? (
                                "…"
                              ) : Number.parseFloat(payslipGross.replace(",", ".")) <= 0 ? (
                                "Requiere bruto"
                              ) : createIncomeTaxFifthPreview?.status === "missing_uit" ? (
                                <span className="text-amber-800 dark:text-amber-200/90">Sin UIT en parámetros legales</span>
                              ) : createIncomeTaxFifthPreview?.status === "ok" ? (
                                <>
                                  Proy. anual {formatPen(createIncomeTaxFifthPreview.annual_projected_gross)}
                                  {createIncomeTaxFifthPreview.deduction_7_uit_amount != null
                                    ? ` · 7 UIT ${formatPen(createIncomeTaxFifthPreview.deduction_7_uit_amount)}`
                                    : ""}
                                  {createIncomeTaxFifthPreview.taxable_annual_base != null
                                    ? ` · Base ${formatPen(createIncomeTaxFifthPreview.taxable_annual_base)}`
                                    : ""}
                                  {createIncomeTaxFifthPreview.effective_rate != null &&
                                  Number.parseFloat(createIncomeTaxFifthPreview.effective_rate) > 0
                                    ? ` · Tasa eff. ${(Number.parseFloat(createIncomeTaxFifthPreview.effective_rate) * 100).toFixed(2)}%`
                                    : ""}
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="p-2 text-right tabular-nums">
                              {createIncomeTaxFifthPreview?.status === "ok" &&
                              createIncomeTaxFifthPreview.monthly_suggested_retention != null
                                ? formatPen(createIncomeTaxFifthPreview.monthly_suggested_retention)
                                : "—"}
                            </td>
                            <td className="p-2 text-right">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={
                                  createIncomeTaxFifthLoading ||
                                  draftHasIncomeTaxLine(createDeductionLines) ||
                                  createIncomeTaxFifthPreview?.status !== "ok" ||
                                  !createIncomeTaxFifthPreview?.proposed_deduction_line
                                }
                                title="Sugerencia referencial (v1); editable en el desglose aplicado."
                                onClick={() => void handleAddIncomeTaxFifthLineCreate()}
                              >
                                {draftHasIncomeTaxLine(createDeductionLines) ? "Ya agregado" : "Añadir línea"}
                              </Button>
                            </td>
                          </tr>
                          <tr className="border-b border-border/50 align-top">
                            <td className="p-2">Renta</td>
                            <td className="p-2">Impuesto renta (manual)</td>
                            <td
                              className="p-2 text-muted-foreground"
                              title="Línea manual; usá la fila superior para sugerencia 5ta categoría."
                            >
                              Manual
                            </td>
                            <td className="p-2 text-right text-muted-foreground">—</td>
                            <td className="p-2 text-right">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={draftHasIncomeTaxLine(createDeductionLines)}
                                onClick={() => {
                                  if (draftHasIncomeTaxLine(createDeductionLines)) {
                                    toast({
                                      title: "Renta ya agregada",
                                      description: "Quitá la línea en el desglose aplicado.",
                                      variant: "destructive",
                                    });
                                    return;
                                  }
                                  setCreateDeductionLines((prev) => [
                                    ...prev,
                                    newDeductionLine({
                                      code: "income_tax",
                                      label: "Impuesto a la renta / 5ta categoría",
                                      amount: "0",
                                    }),
                                  ]);
                                }}
                              >
                                {draftHasIncomeTaxLine(createDeductionLines) ? "Ya agregado" : "Añadir línea"}
                              </Button>
                            </td>
                          </tr>
                          <tr className="align-top">
                            <td className="p-2">Otros</td>
                            <td className="p-2">Otro descuento</td>
                            <td className="p-2 text-muted-foreground">—</td>
                            <td className="p-2 text-right text-muted-foreground">—</td>
                            <td className="p-2 text-right">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() =>
                                  setCreateDeductionLines((prev) => [
                                    ...prev,
                                    newDeductionLine({ code: "other", label: "Otro descuento", amount: "0" }),
                                  ])
                                }
                              >
                                Añadir línea
                              </Button>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div className="flex flex-wrap gap-2 items-center text-[11px] text-muted-foreground pt-1">
                      <span>Nuevo plan:</span>
                      <Input
                        placeholder="Etiqueta"
                        value={newPlanLabel}
                        onChange={(e) => setNewPlanLabel(e.target.value)}
                        className="h-7 text-xs max-w-[120px]"
                      />
                      <Input
                        type="number"
                        placeholder="Total"
                        value={newPlanTotal}
                        onChange={(e) => setNewPlanTotal(e.target.value)}
                        className="h-7 text-xs max-w-[88px]"
                      />
                      <Input
                        type="number"
                        min={1}
                        placeholder="Meses"
                        value={newPlanMonths}
                        onChange={(e) => setNewPlanMonths(e.target.value)}
                        className="h-7 text-xs w-16"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        disabled={newPlanSaving}
                        onClick={() => void handleCreateInstallmentPlan()}
                      >
                        {newPlanSaving ? "…" : "Crear plan"}
                      </Button>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <Checkbox
                        id="ps-previsional"
                        checked={payslipApplyPrevisional}
                        onCheckedChange={(c) => setPayslipApplyPrevisional(c === true)}
                      />
                      <Label
                        htmlFor="ps-previsional"
                        className="text-xs font-normal cursor-pointer leading-tight"
                        title="Al crear la boleta, el servidor puede fusionar AFP/ONP con parámetros legales y unificar códigos previsional_* en meta."
                      >
                        Fusionar AFP/ONP al crear la boleta
                      </Label>
                    </div>

                    <div className="space-y-1.5 pt-1">
                      <span className="text-xs font-medium text-foreground">Desglose aplicado</span>
                      {createDeductionLines.length > 0 ? (
                        <div className="overflow-x-auto max-h-48 overflow-y-auto rounded border border-border/60">
                          <table className="w-full text-xs min-w-[400px]">
                            <thead>
                              <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                                <th className="p-2 font-medium">Concepto</th>
                                <th className="p-2 font-medium w-[28%]">Origen / código</th>
                                <th className="p-2 font-medium text-right w-[22%]">Monto</th>
                                <th className="p-2 w-9" />
                              </tr>
                            </thead>
                            <tbody>
                              {createDeductionLines.map((line) => (
                                <tr key={line.localId} className="border-b border-border/50 last:border-0 align-top">
                                  <td className="p-1.5">
                                    <Input
                                      className="h-7 text-xs"
                                      value={line.label}
                                      onChange={(e) =>
                                        setCreateDeductionLines((prev) =>
                                          prev.map((l) => (l.localId === line.localId ? { ...l, label: e.target.value } : l)),
                                        )
                                      }
                                    />
                                  </td>
                                  <td className="p-1.5 font-mono text-[10px] text-muted-foreground break-all">
                                    {line.code}
                                  </td>
                                  <td className="p-1.5 text-right">
                                    <Input
                                      type="number"
                                      step="0.01"
                                      className="h-7 text-xs text-right"
                                      value={line.amount}
                                      onChange={(e) =>
                                        setCreateDeductionLines((prev) =>
                                          prev.map((l) => (l.localId === line.localId ? { ...l, amount: e.target.value } : l)),
                                        )
                                      }
                                    />
                                  </td>
                                  <td className="p-1.5">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 shrink-0 text-destructive"
                                      onClick={() =>
                                        setCreateDeductionLines((prev) => prev.filter((l) => l.localId !== line.localId))
                                      }
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">Sin líneas aún.</p>
                      )}
                    </div>

                    <p className="text-[11px] text-muted-foreground">
                      El total descuenta del bruto y define el neto sugerido (editable abajo).
                    </p>

                    <div className="space-y-2">
                      <Label htmlFor="ps-ded-total">Total descuentos</Label>
                      <Input id="ps-ded-total" readOnly value={payslipDeductions} className="bg-muted h-9 text-sm" />
                    </div>
                  </>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ps-net">Neto</Label>
                <Input
                  id="ps-net"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={payslipNet}
                  onChange={(e) => handlePayslipNetChange(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Se sugiere bruto − descuentos hasta que edites el neto manualmente.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPayslipDialogOpen(false)} disabled={payslipSaving}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleCreatePayslip()} disabled={payslipSaving}>
              {payslipSaving ? "Guardando…" : "Crear boleta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={payslipEditDialogOpen}
        onOpenChange={(open) => {
          setPayslipEditDialogOpen(open);
          if (!open) {
            setEditPayslipTarget(null);
            setEditAttendancePreview(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar boleta</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {editPayslipTarget && editPayslipPeriod ? (
              <p className="text-sm text-muted-foreground">
                Periodo: <span className="font-medium text-foreground">{periodLabel(editPayslipPeriod)}</span>
                {" · "}
                Empleado:{" "}
                <span className="font-medium text-foreground">
                  {employeeById[editPayslipTarget.employee_id]
                    ? formatEmployeeName(employeeById[editPayslipTarget.employee_id]!)
                    : `#${editPayslipTarget.employee_id}`}
                </span>
              </p>
            ) : null}
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ps-edit-gross">Bruto</Label>
                <Input
                  id="ps-edit-gross"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={editPayslipGross}
                  onChange={(e) => handleEditPayslipGrossChange(e.target.value)}
                />
              </div>
              <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Descuentos (desglose)</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Selecciona las líneas que deseas aplicar. Podrás editar los importes antes de guardar.
                </p>

                {!editPayslipTarget ? (
                  <p className="text-sm text-muted-foreground">Sin datos de boleta.</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-foreground">Descuentos disponibles</span>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="h-8 text-xs"
                          disabled={!selectedPeriodId || attendancePreviewBusy}
                          title="Obtiene montos sugeridos de faltas y tardanzas sin añadirlos al desglose."
                          onClick={() => void handleFetchAttendancePreviewEdit()}
                        >
                          {attendancePreviewBusy ? "…" : "Actualizar sugerencias"}
                        </Button>
                        <Link
                          to={`/descuentos?employee=${editPayslipTarget.employee_id}`}
                          className="text-xs text-primary underline inline-flex items-center gap-1"
                        >
                          Gestionar <ExternalLink className="w-3 h-3" />
                        </Link>
                      </div>
                    </div>

                    <div className="overflow-x-auto rounded border border-border/60">
                      <table className="w-full text-xs min-w-[520px]">
                        <thead>
                          <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                            <th className="p-2 font-medium w-[14%]">Origen</th>
                            <th className="p-2 font-medium w-[18%]">Concepto</th>
                            <th className="p-2 font-medium min-w-[120px]">Detalle</th>
                            <th className="p-2 font-medium text-right w-[14%] whitespace-nowrap">Monto sugerido</th>
                            <th className="p-2 font-medium text-right w-[24%]">Acción</th>
                          </tr>
                        </thead>
                        <tbody className="text-foreground">
                          <tr className="border-b border-border/50 align-top">
                            <td className="p-2">Asistencia</td>
                            <td className="p-2">Faltas no justif.</td>
                            <td className="p-2 text-muted-foreground break-words max-w-[200px]">
                              {editAttendancePreview
                                ? `${editAttendancePreview.absence_days_unjustified} días NJ`
                                : "—"}
                            </td>
                            <td className="p-2 text-right tabular-nums">
                              {editAttendancePreview?.suggested_amounts_computed
                                ? editAttendancePreview.suggested_deduction_absence > 0
                                  ? formatPen(editAttendancePreview.suggested_deduction_absence)
                                  : "—"
                                : editAttendancePreview
                                  ? "Requiere bruto"
                                  : "—"}
                            </td>
                            <td className="p-2 text-right">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={
                                  !selectedPeriodId ||
                                  editDeductionLines.some((l) => l.code === ATTENDANCE_DEDUCTION_LINE_CODE_ABSENCE) ||
                                  !editAttendancePreview?.suggested_amounts_computed ||
                                  (editAttendancePreview?.suggested_deduction_absence ?? 0) <= 0
                                }
                                onClick={() => void handleAddAbsenceLineEdit()}
                              >
                                {editDeductionLines.some((l) => l.code === ATTENDANCE_DEDUCTION_LINE_CODE_ABSENCE)
                                  ? "Ya agregado"
                                  : "Añadir línea"}
                              </Button>
                            </td>
                          </tr>
                          <tr className="border-b border-border/50 align-top">
                            <td className="p-2">Asistencia</td>
                            <td className="p-2">Tardanzas no justif.</td>
                            <td className="p-2 text-muted-foreground break-words max-w-[200px]">
                              {editAttendancePreview
                                ? `${editAttendancePreview.tardiness_events_unjustified} eventos NJ`
                                : "—"}
                            </td>
                            <td className="p-2 text-right tabular-nums">
                              {editAttendancePreview?.suggested_amounts_computed
                                ? editAttendancePreview.suggested_deduction_lateness > 0
                                  ? formatPen(editAttendancePreview.suggested_deduction_lateness)
                                  : "—"
                                : editAttendancePreview
                                  ? "Requiere bruto"
                                  : "—"}
                            </td>
                            <td className="p-2 text-right">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={
                                  !selectedPeriodId ||
                                  editDeductionLines.some((l) => l.code === ATTENDANCE_DEDUCTION_LINE_CODE_LATENESS) ||
                                  !editAttendancePreview?.suggested_amounts_computed ||
                                  (editAttendancePreview?.suggested_deduction_lateness ?? 0) <= 0
                                }
                                onClick={() => void handleAddLatenessLineEdit()}
                              >
                                {editDeductionLines.some((l) => l.code === ATTENDANCE_DEDUCTION_LINE_CODE_LATENESS)
                                  ? "Ya agregado"
                                  : "Añadir línea"}
                              </Button>
                            </td>
                          </tr>
                          <tr className="border-b border-border/50 align-top">
                            <td className="p-2">Previsional</td>
                            <td className="p-2">AFP / ONP</td>
                            <td className="p-2 text-muted-foreground break-words">
                              {editPayslipPrevisionalLoading ? (
                                "…"
                              ) : Number.parseFloat(editPayslipGross.replace(",", ".")) <= 0 ? (
                                "Requiere bruto"
                              ) : editPayslipPrevisional?.status === "unsupported_regime" ? (
                                <span className="text-amber-800 dark:text-amber-200/90">Régimen no soportado</span>
                              ) : editPayslipPrevisional?.status === "missing_legal_rate" ? (
                                <span className="text-amber-800 dark:text-amber-200/90">
                                  Sin tasa {formatAppDate(editPayslipPrevisional.reference_date)}
                                </span>
                              ) : editPayslipPrevisional?.status === "ok" ? (
                                <>
                                  {regimeResolvedLabel(editPayslipPrevisional.regime_resolved)} ·{" "}
                                  {formatRatioPercent(editPayslipPrevisional.ratio)}
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="p-2 text-right tabular-nums text-destructive font-medium">
                              {editPayslipPrevisional?.status === "ok" && editPayslipPrevisional.amount != null
                                ? formatPen(editPayslipPrevisional.amount)
                                : "—"}
                            </td>
                            <td className="p-2 text-right">
                              <div className="flex flex-col gap-1 items-end">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  disabled={
                                    editPayslipPrevisional?.status !== "ok" ||
                                    !editPayslipPrevisional.proposed_deduction_line ||
                                    draftHasPrevisionalLine(editDeductionLines)
                                  }
                                  onClick={() => void handleAddPrevisionalLineEdit()}
                                >
                                  {draftHasPrevisionalLine(editDeductionLines) ? "Ya agregado" : "Añadir línea"}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  className="h-7 text-xs"
                                  disabled={!editPayslipTarget || editApplyPrevisionalBusy}
                                  title="Recalcula AFP/ONP en el servidor y actualiza el desglose de la boleta."
                                  onClick={() => void handleApplyPrevisionalEdit()}
                                >
                                  {editApplyPrevisionalBusy ? "…" : "Aplicar AFP/ONP"}
                                </Button>
                              </div>
                            </td>
                          </tr>
                          {editInstallmentPlans.map((pl) => {
                            const already = draftHasInstallmentForPlan(editDeductionLines, pl.id);
                            const nextAmt = pl.next_installment_amount ?? pl.installment_amount;
                            const nextNum = pl.next_installment_number ?? pl.installments_applied + 1;
                            const cat = deductionPlanCategoryLabelEs(pl.category);
                            return (
                              <tr key={pl.id} className="border-b border-border/50 align-top">
                                <td className="p-2">Plan cuotas</td>
                                <td className="p-2 break-words">{pl.label}</td>
                                <td className="p-2 text-muted-foreground break-words max-w-[200px]">
                                  {[cat, pl.description?.trim()].filter(Boolean).join(" · ") || "—"}
                                  <span className="block text-[11px] mt-0.5">
                                    Cuota {nextNum}/{pl.installment_count} · Pend. {formatPen(pl.remaining_total_amount)}
                                  </span>
                                </td>
                                <td className="p-2 text-right tabular-nums">{formatPen(nextAmt)}</td>
                                <td className="p-2 text-right">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    disabled={already}
                                    onClick={() => appendInstallmentLine(pl, editDeductionLines, setEditDeductionLines)}
                                  >
                                    {already ? "Ya agregado" : "Añadir línea"}
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                          <tr className="border-b border-border/50 align-top">
                            <td className="p-2">Renta</td>
                            <td className="p-2">Impuesto a la renta 5ta categoría</td>
                            <td className="p-2 text-muted-foreground break-words text-[11px] max-w-[220px]">
                              {editIncomeTaxFifthLoading ? (
                                "…"
                              ) : Number.parseFloat(editPayslipGross.replace(",", ".")) <= 0 ? (
                                "Requiere bruto"
                              ) : editIncomeTaxFifthPreview?.status === "missing_uit" ? (
                                <span className="text-amber-800 dark:text-amber-200/90">Sin UIT en parámetros legales</span>
                              ) : editIncomeTaxFifthPreview?.status === "ok" ? (
                                <>
                                  Proy. anual {formatPen(editIncomeTaxFifthPreview.annual_projected_gross)}
                                  {editIncomeTaxFifthPreview.deduction_7_uit_amount != null
                                    ? ` · 7 UIT ${formatPen(editIncomeTaxFifthPreview.deduction_7_uit_amount)}`
                                    : ""}
                                  {editIncomeTaxFifthPreview.taxable_annual_base != null
                                    ? ` · Base ${formatPen(editIncomeTaxFifthPreview.taxable_annual_base)}`
                                    : ""}
                                  {editIncomeTaxFifthPreview.effective_rate != null &&
                                  Number.parseFloat(editIncomeTaxFifthPreview.effective_rate) > 0
                                    ? ` · Tasa eff. ${(Number.parseFloat(editIncomeTaxFifthPreview.effective_rate) * 100).toFixed(2)}%`
                                    : ""}
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="p-2 text-right tabular-nums">
                              {editIncomeTaxFifthPreview?.status === "ok" &&
                              editIncomeTaxFifthPreview.monthly_suggested_retention != null
                                ? formatPen(editIncomeTaxFifthPreview.monthly_suggested_retention)
                                : "—"}
                            </td>
                            <td className="p-2 text-right">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={
                                  editIncomeTaxFifthLoading ||
                                  draftHasIncomeTaxLine(editDeductionLines) ||
                                  editIncomeTaxFifthPreview?.status !== "ok" ||
                                  !editIncomeTaxFifthPreview?.proposed_deduction_line
                                }
                                title="Sugerencia referencial (v1); editable en el desglose aplicado."
                                onClick={() => void handleAddIncomeTaxFifthLineEdit()}
                              >
                                {draftHasIncomeTaxLine(editDeductionLines) ? "Ya agregado" : "Añadir línea"}
                              </Button>
                            </td>
                          </tr>
                          <tr className="border-b border-border/50 align-top">
                            <td className="p-2">Renta</td>
                            <td className="p-2">Impuesto renta (manual)</td>
                            <td
                              className="p-2 text-muted-foreground"
                              title="Línea manual; usá la fila superior para sugerencia 5ta categoría."
                            >
                              Manual
                            </td>
                            <td className="p-2 text-right text-muted-foreground">—</td>
                            <td className="p-2 text-right">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={draftHasIncomeTaxLine(editDeductionLines)}
                                onClick={() => {
                                  if (draftHasIncomeTaxLine(editDeductionLines)) {
                                    toast({
                                      title: "Renta ya agregada",
                                      description: "Quitá la línea en el desglose aplicado.",
                                      variant: "destructive",
                                    });
                                    return;
                                  }
                                  setEditDeductionLines((prev) => [
                                    ...prev,
                                    newDeductionLine({
                                      code: "income_tax",
                                      label: "Impuesto a la renta / 5ta categoría",
                                      amount: "0",
                                    }),
                                  ]);
                                }}
                              >
                                {draftHasIncomeTaxLine(editDeductionLines) ? "Ya agregado" : "Añadir línea"}
                              </Button>
                            </td>
                          </tr>
                          <tr className="align-top">
                            <td className="p-2">Otros</td>
                            <td className="p-2">Otro descuento</td>
                            <td className="p-2 text-muted-foreground">—</td>
                            <td className="p-2 text-right text-muted-foreground">—</td>
                            <td className="p-2 text-right">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() =>
                                  setEditDeductionLines((prev) => [
                                    ...prev,
                                    newDeductionLine({ code: "other", label: "Otro descuento", amount: "0" }),
                                  ])
                                }
                              >
                                Añadir línea
                              </Button>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div className="flex flex-wrap gap-2 items-center text-[11px] text-muted-foreground pt-1">
                      <span>Nuevo plan:</span>
                      <Input
                        placeholder="Etiqueta"
                        value={newPlanLabel}
                        onChange={(e) => setNewPlanLabel(e.target.value)}
                        className="h-7 text-xs max-w-[120px]"
                      />
                      <Input
                        type="number"
                        placeholder="Total"
                        value={newPlanTotal}
                        onChange={(e) => setNewPlanTotal(e.target.value)}
                        className="h-7 text-xs max-w-[88px]"
                      />
                      <Input
                        type="number"
                        min={1}
                        placeholder="Meses"
                        value={newPlanMonths}
                        onChange={(e) => setNewPlanMonths(e.target.value)}
                        className="h-7 text-xs w-16"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        disabled={newPlanSaving}
                        onClick={() => void handleCreateInstallmentPlanFromEdit()}
                      >
                        {newPlanSaving ? "…" : "Crear plan"}
                      </Button>
                    </div>

                    <div className="space-y-1.5 pt-1">
                      <span className="text-xs font-medium text-foreground">Desglose aplicado</span>
                      {editDeductionLines.length > 0 ? (
                        <div className="overflow-x-auto max-h-48 overflow-y-auto rounded border border-border/60">
                          <table className="w-full text-xs min-w-[400px]">
                            <thead>
                              <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                                <th className="p-2 font-medium">Concepto</th>
                                <th className="p-2 font-medium w-[28%]">Origen / código</th>
                                <th className="p-2 font-medium text-right w-[22%]">Monto</th>
                                <th className="p-2 w-9" />
                              </tr>
                            </thead>
                            <tbody>
                              {editDeductionLines.map((line) => (
                                <tr key={line.localId} className="border-b border-border/50 last:border-0 align-top">
                                  <td className="p-1.5">
                                    <Input
                                      className="h-7 text-xs"
                                      value={line.label}
                                      onChange={(e) =>
                                        setEditDeductionLines((prev) =>
                                          prev.map((l) => (l.localId === line.localId ? { ...l, label: e.target.value } : l)),
                                        )
                                      }
                                    />
                                  </td>
                                  <td className="p-1.5 font-mono text-[10px] text-muted-foreground break-all">
                                    {line.code}
                                  </td>
                                  <td className="p-1.5 text-right">
                                    <Input
                                      type="number"
                                      step="0.01"
                                      className="h-7 text-xs text-right"
                                      value={line.amount}
                                      onChange={(e) =>
                                        setEditDeductionLines((prev) =>
                                          prev.map((l) => (l.localId === line.localId ? { ...l, amount: e.target.value } : l)),
                                        )
                                      }
                                    />
                                  </td>
                                  <td className="p-1.5">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 shrink-0 text-destructive"
                                      onClick={() =>
                                        setEditDeductionLines((prev) => prev.filter((l) => l.localId !== line.localId))
                                      }
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">Sin líneas aún.</p>
                      )}
                    </div>

                    <p className="text-[11px] text-muted-foreground">
                      El total descuenta del bruto y define el neto sugerido (editable abajo).
                    </p>

                    <div className="space-y-2">
                      <Label htmlFor="ps-edit-ded">Total descuentos</Label>
                      <Input id="ps-edit-ded" readOnly value={editPayslipDeductions} className="bg-muted h-9 text-sm" />
                    </div>
                  </>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ps-edit-net">Neto</Label>
                <Input
                  id="ps-edit-net"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={editPayslipNet}
                  onChange={(e) => handleEditPayslipNetChange(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Se sugiere bruto − descuentos hasta que edites el neto manualmente.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPayslipEditDialogOpen(false)}
              disabled={editPayslipSaving}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleUpdatePayslip()} disabled={editPayslipSaving}>
              {editPayslipSaving ? "Guardando…" : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={payslipToDelete !== null} onOpenChange={(open) => !open && !payslipDeleteSaving && setPayslipToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta boleta?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borrará el registro de nómina de forma permanente. El empleado dejará de ver esta boleta en su portal y se
              eliminarán las notificaciones asociadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={payslipDeleteSaving}>Cancelar</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={payslipDeleteSaving}
              onClick={() => void handleConfirmDeletePayslip()}
            >
              {payslipDeleteSaving ? "Eliminando…" : "Eliminar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
