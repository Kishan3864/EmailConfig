import { getT } from "@/lib/i18n-server";
import { EmptyState } from "@/components/ui";

export default async function NotFound() {
  const { t } = await getT();
  return (
    <div className="card-flush mx-auto mt-6 max-w-lg">
      <EmptyState icon="search" title={t("Ye page nahi mila", "Page not found")} text={t("Ho sakta hai link purana ho ya ye cheez delete ho chuki ho.", "The link may be old, or this item may have been deleted.")} href="/" cta={t("Dashboard pe jao", "Go to dashboard")} />
    </div>
  );
}
