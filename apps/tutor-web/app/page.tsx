import { SetupScreen } from "@/features/setup/SetupScreen";

export default async function Page({ searchParams }: PageProps<"/">) {
  const { edit } = await searchParams;
  return <SetupScreen editing={edit === "1"} />;
}
