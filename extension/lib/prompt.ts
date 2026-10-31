/**
 * Model-facing classification text, shared by both adapters.
 *
 * Jev (`noul` / `choice` / `score`) and OpenAI Decisions (`predicate` /
 * `choice` / `score`) ask three questions about the same reply. If they are
 * written in different places, they drift, and a reply cleared by one answer is
 * folded by another: a non-`human` `bait_kind` alone floors the score at 0.55,
 * which is the default fold threshold. So the rules live here, once.
 *
 * Design rule: slop must be established by a concrete tell found in the text.
 * Brevity, dryness, formality, non-native grammar, missing personality and a
 * plain "@bot do X" directive are all ordinary for a person typing a reply —
 * scoring them is the false positive this text exists to avoid. Nothing here
 * proves human authorship either; a directive is only *insufficient* evidence
 * of machine authorship, so a directive that also carries a real tell (promo
 * bait, assistant voice, emoji decor) still gets flagged.
 *
 * Scope: a user-supplied prompt replaces `is_slop` only. `bait_kind` and
 * `bot_likelihood` keep their fixed shape because the model has to answer with
 * one of those buckets/levels, and the score mapper reads them by name.
 */

export const DEFAULT_PROMPT = [
  'Decide whether this X reply is low-value automated engagement (AI-written, bot-farm or template spam), or an ordinary human reply.',
  '',
  'Score high only when this text itself contains a concrete tell:',
  '- assistant/LLM voice: "as an AI", "hope this helps", "it\'s important to note", "let\'s dive in"',
  '- rhetorical scaffolding: "not just X, it\'s Y", rule-of-three lists, em-dash asides, "in today\'s fast-paced world"',
  '- generic praise or agreement with no specifics: "Great point!", "This is a game-changer", "Couldn\'t agree more"',
  '- hype with no content, engagement-farming questions, DM / link-in-bio / airdrop / giveaway / guaranteed-returns bait',
  '- template symmetry: the same cadence repeated, decorative emoji runs (rocket, fire, 100), hashtag stuffing, sign-off signatures',
  '',
  'One stylistic trait is not enough. Shortness, dryness, bluntness, formality, imperfect grammar, translationese, no emoji, and text in Chinese, Japanese or Korean are ordinary human registers — do not raise the score for them.',
  '',
  'A directive, question, answer or correction — including "@bot do X" and any instruction addressed to an account or bot — carries no evidence about who wrote it. The word "bot" in the text is what the author typed, not proof of authorship, and the same command repeated across accounts can be people copy-pasting a public instruction. Judge the text on its own, and still flag the reply when it also carries a real tell from the list above.',
  '',
  'If the only signal you can name is "it reads generic", answer human — that is not evidence. If the text is too short or too empty to tell, answer uncertain rather than probably-AI.',
].join('\n');

/**
 * A user prompt wins only when it has content; whitespace-only and absent both
 * fall back to the current rules instead of sending an empty instruction.
 */
export function resolvePrompt(settings: { defaultPrompt?: string }): string {
  const custom = (settings.defaultPrompt ?? '').trim();
  return custom || DEFAULT_PROMPT;
}

export const SLOP_TRUE =
  'Low-value automated engagement with a concrete tell in this text: assistant voice, rhetorical scaffolding, generic praise, promo/engagement bait, or template repetition.';

export const SLOP_FALSE =
  'An ordinary-looking reply: a command, question, answer, correction, joke, opinion or specific detail — including terse, dry, formal, non-native and non-English text, and "@bot" directives that carry no other tell.';

export const BOT_LIKELIHOOD_INSTRUCTIONS =
  'How likely is this reply written by AI or a bot farm? The top levels need a concrete tell from the rules above; brevity, plainness, formality, non-native grammar or the same command repeated across accounts stay human.';

export const BOT_LIKELIHOOD_LEVELS = [
  'Clearly human — a person typing, or nothing to judge',
  'Probably human — no concrete AI tell, even if short or plain',
  'Uncertain — some template shape, nothing conclusive',
  'Probably AI — one concrete tell',
  'Clearly AI — several concrete tells together',
];

export const BAIT_KIND_INSTRUCTIONS =
  'If this is low-value engagement, which bucket fits best? Answer "human" for ordinary replies, including short, plain, directive and non-English ones.';

export const BAIT_KIND_HUMAN_DESCRIPTION =
  'Ordinary-looking reply, including terse, plain and "@bot do X" directives with no other tell';
