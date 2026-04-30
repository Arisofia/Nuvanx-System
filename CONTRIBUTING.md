# Contributing to Nuvanx System

Gracias por contribuir a Nuvanx System. Este documento describe las prácticas mínimas para mantener la calidad del código y facilitar revisiones.

## Flujo de trabajo

- Cree ramas con un nombre claro y específico: `feature/<descripción>`, `fix/<descripción>`, `chore/<descripción>`.
- Abra Pull Requests hacia `main`.
- Añada una descripción clara del cambio y el problema que resuelve.
- Etiquete la PR con la categoría correcta (bugfix, feature, docs, ci).

## Requisitos de la PR

- Un PR debe incluir al menos una prueba nueva cuando se modifica funcionalidad crítica.
- Actualice la documentación si el cambio afecta el comportamiento o la configuración.
- Asegúrese de que GitHub Actions pase antes de solicitar revisión.
- Después de aprobaciones, haga merge usando `Merge` o `Rebase and merge` según la política del equipo.

## Estilo de commits

Use el formato de Conventional Commits:

```
<type>(<scope>): <descripción corta>

<body opcional>
```

Ejemplos:

- `feat(backend): add health check route`
- `fix(ci): validate required secrets in deployment workflow`
- `chore(docs): add contributing and codeowners`

Tipos comunes:

- `feat` — nueva funcionalidad
- `fix` — corrección de bug
- `chore` — tarea de mantenimiento
- `docs` — cambios de documentación
- `refactor` — mejoras internas sin cambio funcional
- `test` — adición o ajuste de pruebas

## Pruebas

### Backend

```bash
cd backend && npm test
```
### Frontend

```bash
npm --prefix frontend run test:ci
```
### Frontend

Si se agregan tests de frontend, use el script correspondiente en `frontend/package.json`.

## Revisión de código

- Asegúrese de que los cambios sean pequeños y enfocados.
- Verifique que todas las rutas de código nuevas estén cubiertas por pruebas.
- No mezcle cambios de estilo con cambios funcionales en el mismo PR.

## Configuración del entorno local

1. Instale dependencias:

```bash
npm run install:all
```

2. Inicie el backend:

```bash
npm --prefix backend run dev
```

3. Inicie el frontend:

```bash
npm --prefix frontend run dev
```

4. Configure variables de entorno: revise `.env.example` y `.github/workflows`.
