import type { Settings } from "./settings";
import { footer } from "./lang";
import { LOGO_HEIGHT, LOGO_PNG_BASE64, LOGO_WIDTH } from "./logo";

// The AI writes only the body. Signature, footer and (optionally) the logo are added here by the app.

export function signature(s: Settings) {
  const lines = [s.senderName, [s.senderRole, s.business].filter(Boolean).join(", "), s.website, ...s.portfolio.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean)];
  return lines.filter(Boolean).join("\n");
}

/** Plain-text version: always sent, and the only part when the logo is off. */
export function fullText(s: Settings, body: string, lang: string, source: string) {
  return `${body.trim()}\n\n${signature(s)}\n\n${footer(lang, source, s.postalAddress)}`;
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const lines = (t: string) => t.split("\n").map(esc).join("<br>");

export const logoCid = (s: Settings) => `logo@${s.fromEmail.split("@")[1] || "mail"}`;

/**
 * HTML version, used only when "logo in signature" is on. Same words as the plain text, in a plain
 * layout: no links, no remote images, no tracking. The logo is embedded in the mail itself (cid).
 */
export function fullHtml(s: Settings, body: string, lang: string, source: string) {
  const paras = body.trim().split(/\n\s*\n/).map((p) => `<p style="margin:0 0 14px">${lines(p.trim())}</p>`).join("");
  const foot = footer(lang, source, s.postalAddress).split("\n").filter((l) => l.trim() !== "--").join("\n");
  return [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222222">`,
    paras,
    `<p style="margin:18px 0 8px">${lines(signature(s))}</p>`,
    `<img src="cid:${logoCid(s)}" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" alt="${esc(s.business || "Logo")}" style="display:block;border:0">`,
    `<p style="margin:14px 0 0;padding-top:8px;border-top:1px solid #dddddd;font-size:12px;color:#666666">${lines(foot)}</p>`,
    `</div>`,
  ].join("");
}

export function logoAttachment(s: Settings) {
  return { filename: "logo.png", content: Buffer.from(LOGO_PNG_BASE64, "base64"), contentType: "image/png", cid: logoCid(s), contentDisposition: "inline" as const };
}

/** Everything buildRaw needs for one outreach mail, with or without the logo. */
export function mailParts(s: Settings, body: string, lang: string, source: string) {
  const text = fullText(s, body, lang, source);
  return s.signatureLogo ? { text, html: fullHtml(s, body, lang, source), attachments: [logoAttachment(s)] } : { text };
}
