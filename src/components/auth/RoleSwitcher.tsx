import { useAuth, AppRole, ROLE_LABELS } from "@/contexts/AuthContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield } from "lucide-react";

const roles: AppRole[] = ["superadmin_rrhh", "admin_rrhh", "jefe_area", "empleado"];

export function RoleSwitcher() {
  const { user, switchRole } = useAuth();

  return (
    <div className="flex items-center gap-2">
      <Shield className="w-4 h-4 text-muted-foreground" />
      <Select value={user.rol} onValueChange={(v) => switchRole(v as AppRole)}>
        <SelectTrigger className="h-8 w-[180px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {roles.map((r) => (
            <SelectItem key={r} value={r} className="text-xs">
              {ROLE_LABELS[r]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
