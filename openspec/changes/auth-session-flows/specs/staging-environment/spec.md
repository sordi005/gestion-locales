## MODIFIED Requirements

### Requirement: Previews de Vercel por PR contra staging
El repo SHALL estar vinculado a un proyecto de Vercel (plan Hobby mientras se desarrolla) que despliega un preview por cada PR. Las variables de entorno del scope **Preview** MUST apuntar al proyecto Supabase de **staging** (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` marcada como sensible) y nunca a producción (KB 02 §Entornos); `NEXT_PUBLIC_SITE_URL` MUST ser la URL pública del proyecto de Vercel (`https://<proyecto>.vercel.app`), no la de Supabase: en los previews la app arma los links de retorno con el origen de cada request y usa esta variable solo como respaldo. Por ser un repo público, MUST quedar activadas la protección de forks de Vercel (un PR desde un fork no se despliega con nuestras variables sin autorización) y la autenticación de Vercel en los previews. Ninguna clave se versiona en el repo ni se agrega al CI de PR.

#### Scenario: Preview de un PR
- **WHEN** se abre un PR en GitHub
- **THEN** Vercel publica un deployment de preview, su URL aparece en el PR y al abrirla sin sesión se llega a `/login`, que muestra `[NOMBRE-PRODUCTO]`

#### Scenario: Variables del preview
- **WHEN** el fundador revisa las variables del proyecto en Vercel
- **THEN** las del scope Preview tienen la URL y las claves del Supabase de staging, `SUPABASE_SECRET_KEY` está marcada como sensible y `NEXT_PUBLIC_SITE_URL` es `https://<proyecto>.vercel.app`

#### Scenario: PR desde un fork
- **WHEN** alguien sin acceso al repo abre un PR desde un fork
- **THEN** Vercel no lo despliega con las variables de staging hasta que el dueño lo autorice

#### Scenario: Ninguna clave en el repo
- **WHEN** se busca `sb_secret_` o `sb_publishable_` seguido de un valor real en archivos versionados
- **THEN** no hay coincidencias fuera de los valores inventados de los tests

## ADDED Requirements

### Requirement: Auth de staging configurado a mano
Como `supabase/config.toml` no se sube a staging, el panel de Auth del proyecto `staging` SHALL configurarse a mano por el fundador, siguiendo una guía paso a paso en castellano llano en el README: alta pública apagada ("Allow new users to sign up" desactivado) con el proveedor Email encendido; largo mínimo de contraseña 8; Site URL `https://<proyecto>.vercel.app`; en Redirect URLs, el patrón de los previews `https://*-<equipo>.vercel.app/**`; y un usuario de prueba propio creado desde el panel con el email confirmado. La guía MUST avisar que los emails de staging salen con la plantilla estándar de Supabase (en inglés, sin personalizar en el plan Free con el SMTP por defecto), que el link de recupero se abre en el mismo navegador donde se pidió, y que el SMTP por defecto manda como máximo 2 emails por hora en todo el proyecto.

#### Scenario: El fundador configura Auth de staging
- **WHEN** el fundador sigue la guía en el panel de Supabase del proyecto `staging`
- **THEN** el alta pública queda apagada, el ingreso con email sigue encendido, el mínimo es 8 y los previews de Vercel están en las Redirect URLs

#### Scenario: Verificación en el preview
- **WHEN** el fundador abre el preview del PR de C-05, ingresa con su usuario de prueba, cierra sesión, pide un recupero, abre el email en el mismo navegador, define una contraseña nueva e ingresa con ella
- **THEN** cada paso funciona: ve "Hola, …" después de ingresar (la lectura de `profiles` por la Data API funciona en staging), vuelve a `/login` al cerrar sesión, y la contraseña nueva sirve y la vieja no
