-- Guardia de RLS: toda tabla de `public` tiene RLS habilitado y toda vista de
-- `public` declara `security_invoker = true` (una vista sin esa opción se saltea
-- RLS). Sin excepciones implícitas: si alguna vez hiciera falta una, se agrega
-- acá, explícita y comentada.
--
-- También exige que toda clave foránea de `public` tenga un índice que empiece por
-- sus columnas (las políticas RLS y los borrados del padre dependen de esos joins).
--
-- Y que el rol anon no alcance nada de `public`: ningún privilegio de tabla, vista,
-- secuencia o columna y ningún EXECUTE de función (salvo objetos de extensiones). El
-- producto no tiene páginas públicas con datos.
--
-- Si falla, el diagnóstico de `is_empty` lista las tablas, vistas o FKs encontradas.
begin;

select plan(4);

select is_empty(
  $$select * from tests.tables_without_rls('public')$$,
  'Toda tabla de public tiene RLS habilitado'
);

select is_empty(
  $$select * from tests.views_without_security_invoker('public')$$,
  'Toda vista de public declara security_invoker = true'
);

select is_empty(
  $$select * from tests.foreign_keys_without_index('public')$$,
  'Toda FK de public tiene un índice que empieza por sus columnas'
);

select is_empty(
  $$select * from tests.anon_exposed_objects('public')$$,
  'anon no tiene privilegios sobre ninguna tabla, secuencia ni función de public'
);

select * from finish();

rollback;
