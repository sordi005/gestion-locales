## Change

<!-- Un PR por change. Id y nombre (ver CHANGES.md) y enlace a su carpeta de OpenSpec. -->

- Change: `C-XX nombre`
- OpenSpec: `openspec/changes/<nombre>/` (pegá el enlace a la carpeta en esta rama)

## Qué cambia

<!-- En 2 o 3 líneas, en lenguaje llano: qué hace distinto la app o el repo después de este PR. -->

## Cómo probarlo

<!-- Pasos para verificarlo a mano o comandos que lo prueban (por ejemplo `pnpm check`, `pnpm test:db`). Si hay pantallas nuevas, mirá el preview de Vercel. -->

## Definition of Done

- [ ] Tests en verde (`pnpm test`; `pnpm test:db` si toca la base; `pnpm test:e2e` si toca pantallas)
- [ ] Lint y formato (`pnpm lint` y `pnpm format:check`)
- [ ] Typecheck (`pnpm typecheck`)
- [ ] Build (`pnpm build`)
- [ ] Cada tabla nueva trae su test A↔B (`tests.assert_cross_tenant_denied`) y tiene RLS habilitado
- [ ] Si cambió el esquema, `src/shared/db/types.ts` está regenerado (`pnpm db:types`)
- [ ] Sin secretos ni archivos `.env*` en el diff
- [ ] Si hay UI nueva, revisé el preview del PR
- [ ] La spec del change está archivada en OpenSpec (`/opsx:archive`)
