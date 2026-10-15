"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { Icon } from "@/components/icons";
import { friendlyError, useToast } from "@/components/toast";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const message = friendlyError(error);
  useEffect(() => { toast.error("Page load nahi ho paya", message); }, [message, toast]);
  // reset() alone re-renders the same failed server result; refresh() asks the server again
  const retry = () => start(() => { router.refresh(); reset(); });
  return (
    <div className="card mx-auto mt-6 max-w-lg text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-red-50 text-red-600"><Icon name="alert" size={22} /></span>
      <h1 className="mt-4 text-lg font-semibold text-slate-900">Kuch gadbad ho gayi</h1>
      <p className="mt-1 text-sm text-slate-500">Ye page abhi load nahi ho paya. Ho sakta hai database ya internet thodi der ke liye ruka ho. Dobara try karo.</p>
      {message && <pre className="mail mt-4 max-h-40 overflow-auto text-left text-xs">{message}</pre>}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={retry} disabled={pending} className="btn-primary">
          <Icon name={pending ? "loader" : "refresh"} size={14} className={pending ? "animate-spin" : ""} />Dobara try karo
        </button>
        <Link href="/" className="btn">Dashboard pe jao</Link>
      </div>
    </div>
  );
}
