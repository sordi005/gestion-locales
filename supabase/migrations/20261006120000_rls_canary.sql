-- Migración trampa de C-02 (tarea 9.2): tabla sin RLS para probar que el CI la frena.
-- NUNCA se mergea.
create table public.rls_canary (id int);
