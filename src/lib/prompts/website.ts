import { trimForPrompt } from '@/lib/gemini';

export interface WebsiteBrief {
  brandName: string;
  description: string;
  websiteType?: string; // e.g. "Restaurant", "Portfolio" — from the follow-up flow
  theme?: string; // e.g. "Minimal", "Bold", "Editorial"
  colorPreference?: string; // e.g. "Warm neutrals", "Dark + neon accent"
  style?: string; // e.g. "Playful", "Corporate", "Luxury"
  sourceUrl?: string; // present only for "Generate from Website URL"
  importedContent?: string; // scraped/trimmed content from sourceUrl
}

const SYSTEM_PROMPT = `You are owbrand's website generation engine. Output a complete, responsive
website as React + Tailwind CSS components. Structure: Navbar, Hero, About, Services/Features,
and any additional sections the brief clearly implies, then Footer. Return valid, self-contained
JSX per section. No commentary, no markdown fences — code only, as strict JSON matching the
requested schema.`;

/** Kept deliberately short — every extra token here is billed on every single generation. */
export function buildWebsitePrompt(brief: WebsiteBrief): { systemPrompt: string; userPrompt: string } {
  const lines = [
    `Brand: ${brief.brandName}`,
    `Description: ${trimForPrompt(brief.description, 1200)}`,
    brief.websiteType && `Type: ${brief.websiteType}`,
    brief.theme && `Theme: ${brief.theme}`,
    brief.colorPreference && `Colors: ${brief.colorPreference}`,
    brief.style && `Style: ${brief.style}`,
    brief.importedContent && `Reference content (from ${brief.sourceUrl}):\n${trimForPrompt(brief.importedContent, 3000)}`,
  ].filter(Boolean);

  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: lines.join('\n'),
  };
}

const FOLLOWUP_SYSTEM_PROMPT = `You are owbrand's prompt-engineering assistant. Given a short brand
description, ask up to 4 quick follow-up questions (website type, theme, color preference, style),
each with 3-5 selectable options. Return strict JSON: { "questions": [{ "id": string, "question":
string, "options": string[] }] }. No commentary.`;

export function buildFollowupPrompt(brandDescription: string): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: FOLLOWUP_SYSTEM_PROMPT,
    userPrompt: trimForPrompt(brandDescription, 800),
  };
}

const EDIT_SYSTEM_PROMPT = `You are owbrand's AI Website Assistant. Given the current site structure
and a natural-language edit request, return only the diff needed: which section(s) change and their
new JSX. Do not regenerate unaffected sections. Strict JSON: { "changes": [{ "section": string, "jsx":
string }] }. No commentary.`;

export function buildEditPrompt(currentSiteSummary: string, editRequest: string) {
  return {
    systemPrompt: EDIT_SYSTEM_PROMPT,
    userPrompt: `Current sections: ${trimForPrompt(currentSiteSummary, 1500)}\nRequest: ${editRequest}`,
  };
}
