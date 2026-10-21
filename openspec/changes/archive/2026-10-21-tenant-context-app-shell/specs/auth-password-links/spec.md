## MODIFIED Requirements

### Requirement: Definir la contraseña
`/actualizar-contrasena` SHALL mostrar el email de la cuenta cuya contraseña se va a definir ("Cuenta: {email}", tomado de la sesión verificada en el servidor), "Contraseña nueva" y "Repetir contraseña" (`autocomplete="new-password"`), el botón "Guardar contraseña" y la opción "Cancelar" (cierra la sesión y vuelve a `/login`), y solo funcionar con una sesión de definir contraseña vigente. El formulario MUST incluir el email como campo `username` de solo lectura oculto a la vista, para que el gestor de contraseñas del navegador guarde la nueva con la cuenta correcta. Su Server Action MUST validar con Zod la política de contraseña y que las dos coincidan ("Las contraseñas no coinciden."), volver a verificar la sesión en el servidor, guardar con `updateUser({ password })`, cerrar **todas** las sesiones de la persona (`signOut({ scope: "global" })`) y redirigir a `/login?aviso=contrasena-actualizada`, que muestra "Listo, guardamos tu contraseña. Ingresá con la nueva.". Si Supabase rechaza por contraseña repetida, MUST mostrar "Elegí una contraseña distinta de la anterior."; por contraseña débil, "Esa contraseña es muy fácil de adivinar. Probá con otra.".

#### Scenario: Recupero completo
- **WHEN** un usuario aislado pide el recupero, abre el link de Mailpit, toca "Continuar", define una contraseña nueva válida y vuelve a ingresar
- **THEN** ve el aviso de contraseña guardada en `/login`, la contraseña vieja ya no sirve y la nueva sí

#### Scenario: Se ve la cuenta
- **WHEN** un usuario aislado abre `/actualizar-contrasena` desde su link de recupero
- **THEN** la pantalla muestra "Cuenta: {su email}"

#### Scenario: Contraseñas distintas
- **WHEN** las dos contraseñas no coinciden
- **THEN** se ve "Las contraseñas no coinciden." y no se llama a Supabase

#### Scenario: Las demás sesiones quedan cerradas
- **WHEN** la persona tenía otra sesión abierta antes de definir la contraseña nueva
- **THEN** el refresh token de esa otra sesión deja de servir

#### Scenario: Cancelar
- **WHEN** en `/actualizar-contrasena` se toca "Cancelar"
- **THEN** la sesión temporal se cierra y se vuelve a `/login`
