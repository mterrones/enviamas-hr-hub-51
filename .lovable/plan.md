

## Plan: Modal de Nuevo Usuario en Configuración

### Objetivo
Agregar un Dialog al botón "Nuevo Usuario" en la pestaña Usuarios de Configuración, permitiendo registrar usuarios con rol Admin RRHH o Jefe de Área.

### Cambio único en `src/pages/SettingsPage.tsx`

1. **Convertir a componente con estado**: agregar `useState` para `showNuevoUsuario`, campos del formulario (`nombre`, `email`, `rol`, `area`, `password`) y lista dinámica de usuarios
2. **Dialog con formulario**:
   - **Nombre completo** (Input)
   - **Email** (Input type email)
   - **Rol** (Select): Admin RRHH, Jefe de Área
   - **Área** (Select, visible solo si rol = Jefe de Área): Contact Center, Ventas, Soporte, Administración, etc.
   - **Contraseña temporal** (Input type password)
3. **Al guardar**: agregar usuario a la lista local con estado "Activo", cerrar modal, toast de confirmación
4. **Botón** → `onClick={() => setShowNuevoUsuario(true)}`

### Imports adicionales
- `Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter`
- `Select, SelectContent, SelectItem, SelectTrigger, SelectValue`
- `Textarea` (no necesario aquí), `useToast`
- `useState` de React

