"use client";
import { createContext, useContext, useTransition, type FormEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Icon, type IconName } from "./icons";
import { useT } from "./lang";
import { friendlyError, resultKind, useToast } from "./toast";

const Pending = createContext(false);

/**
 * A form whose fields go to a server action; the result shows as a toast.
 * On an error or warning the typed values stay in the form. reset clears the fields after a clean success.
 * Not for actions that redirect (use a plain <form action={…}> with <SubmitButton> for those).
 */
export function ActionForm({ action, ok, errTitle, next, nextCta, reset = false, className, children }: {
  action: (fd: FormData) => Promise<string | void>; ok?: string; errTitle?: string; next?: string; nextCta?: string; reset?: boolean; className?: string; children: ReactNode;
}) {
  const toast = useToast();
  const { t } = useT();
  const [pending, start] = useTransition();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const form = e.currentTarget;
    const fd = new FormData(form);
    start(async () => {
      try {
        const r = await action(fd);
        toast.result(r, { okTitle: ok ?? t("Save ho gaya", "Saved"), errTitle, href: next, cta: nextCta });
        if (reset && resultKind(r) === "success") form.reset();
      } catch (err) {
        toast.error(errTitle || t("Problem aa gayi", "Something went wrong"), friendlyError(err, t));
      }
    });
  };
  return (
    <Pending.Provider value={pending}>
      <form onSubmit={onSubmit} className={className} aria-busy={pending}>{children}</form>
    </Pending.Provider>
  );
}

/** Submit button that shows a spinner while its form (ActionForm or a plain server-action form) is busy. */
export function SubmitButton({ children, className = "btn-primary", icon, pendingText }: { children: ReactNode; className?: string; icon?: IconName; pendingText?: string }) {
  const { t } = useT();
  const own = useContext(Pending);
  const { pending: native } = useFormStatus();
  const pending = own || native;
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? <Icon name="loader" size={14} className="animate-spin" /> : icon ? <Icon name={icon} size={14} /> : null}
      {pending ? (pendingText ?? t("Ho raha hai…", "Working…")) : children}
    </button>
  );
}
