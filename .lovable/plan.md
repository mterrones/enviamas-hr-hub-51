

## Plan: Sincronizar toasts con el panel de notificaciones

### Objetivo
Cada vez que se dispare un `toast()` en la app (al crear empleado, registrar activo, enviar solicitud, etc.), también se agregue automáticamente como notificación en el panel de la campana del TopBar.

### Enfoque
Crear un contexto global de notificaciones (`NotificationsContext`) que:
1. Mantenga la lista de notificaciones de forma global (no solo en TopBar)
2. Exponga una función `addNotification` que se pueda llamar desde cualquier parte
3. Intercepte los toasts para agregar notificaciones automáticamente

### Archivos a crear/modificar

**1. Crear `src/contexts/NotificationsContext.tsx`**
- Context con estado global de notificaciones y funciones: `addNotification`, `markAsRead`, `deleteNotification`
- Incluir las notificaciones iniciales existentes
- Función `addNotification(title, description, type, link?)` que genera un nuevo item con timestamp "Justo ahora"

**2. Modificar `src/hooks/use-toast.ts`**
- Agregar un listener global (`onToastAdded`) que el contexto de notificaciones pueda suscribirse
- Cuando se dispara un toast (no destructive/error), emitir al listener con título y descripción

**3. Modificar `src/components/layout/TopBar.tsx`**
- Reemplazar el `useState` local de notificaciones por `useNotifications()` del contexto
- Simplificar: el estado ahora vive en el contexto

**4. Modificar `src/components/notifications/NotificationsPanel.tsx`**
- Recibir las funciones del contexto vía props (sin cambios grandes, ya es controlado)

**5. Modificar `src/App.tsx` o `src/main.tsx`**
- Envolver la app con `NotificationsProvider`

### Mapeo de tipo de toast a notificación
- Toast normal → tipo "info", link según la ruta actual
- Toast destructive → tipo "warning", sin agregar a notificaciones (son errores de validación)

### Flujo
```text
Usuario guarda → toast({ title, description }) 
  → use-toast dispatch + listener global
  → NotificationsContext.addNotification()
  → Campana muestra nuevo badge
```

