-- Guardia de RLS: toda tabla de `public` tiene RLS habilitado y toda vista de
-- `public` declara `security_invoker = true` (una vista sin esa opción se saltea
-- RLS). Sin excepciones implícitas: si alguna vez hiciera falta una, se agrega
-- acá, explícita y comentada.
--
-- Si falla, el diagnóstico de `is_empty` lista las tablas o vistas encontradas.
begin;

select plan(2);

select is_empty(
  $$select * from tests.tables_without_rls('public')$$,
  'Toda tabla de public tiene RLS habilitado'
);

select is_empty(
  $$select * from tests.views_without_security_invoker('public')$$,
  'Toda vista de public declara security_invoker = true'
);

select * from finish();

rollback;
