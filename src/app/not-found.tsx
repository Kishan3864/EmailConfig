import { EmptyState } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="card-flush mx-auto mt-6 max-w-lg">
      <EmptyState icon="search" title="Ye page nahi mila" text="Ho sakta hai link purana ho ya ye cheez delete ho chuki ho." href="/" cta="Dashboard pe jao" />
    </div>
  );
}
