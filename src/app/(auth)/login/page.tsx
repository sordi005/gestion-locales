import { LoginForm } from "@/features/auth/components";
import {
  firstParam,
  loginNoticeFromAviso,
  safeNextPath,
} from "@/features/auth/routing";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, aviso } = await searchParams;
  const requestedNext = firstParam(next);

  return (
    <LoginForm
      // `safeNextPath` descarta todo lo que no sea una ruta interna (redirección abierta).
      next={
        requestedNext === undefined ? undefined : safeNextPath(requestedNext)
      }
      notice={loginNoticeFromAviso(firstParam(aviso))}
    />
  );
}
