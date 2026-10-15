import { cookies } from "next/headers";
import { LANG_COOKIE, makeT, toLang } from "./i18n";

/** UI language for server components, server actions, route handlers and generateMetadata. */
export async function getT() {
  const lang = toLang((await cookies()).get(LANG_COOKIE)?.value);
  return { lang, t: makeT(lang) };
}
