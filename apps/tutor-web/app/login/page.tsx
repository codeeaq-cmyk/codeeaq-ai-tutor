import { LoginScreen } from "@/features/auth/LoginScreen";
import { safeNext } from "@/lib/route";

export default async function Page({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return <LoginScreen next={safeNext(next)} />;
}
