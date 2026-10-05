import { PRODUCT_NAME } from "@/shared/lib/brand";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">{PRODUCT_NAME}</h1>
      <p className="text-lg text-muted-foreground">En construcción</p>
    </div>
  );
}
