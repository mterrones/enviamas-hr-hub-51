

## Plan: Agregar campo "Examen Médico Ocupacional" en registro y perfil de empleado

### Cambios

**1. `src/pages/NewEmployeePage.tsx`**
- En la sección de documentos PDF (líneas 113-121), agregar un tercer campo de tipo file para "Examen Médico Ocupacional (PDF)" cambiando el grid a 3 columnas (`md:grid-cols-3`)

**2. `src/pages/EmployeeProfilePage.tsx`**
- En la sección "Documentos" del tab "Datos Personales" (líneas 95-101), agregar un tercer botón "Examen Médico (PDF)" junto a los botones existentes de Antecedentes y CV

