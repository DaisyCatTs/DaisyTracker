import type { APIEmbed, APIEmbedField } from "discord-api-types/v10";
import { DaisyTrackerError } from "./errors";
import type { DiscordWebhookPayload } from "./types";

export const DISCORD_LIMITS = {
  authorName: 256,
  content: 2000,
  description: 4096,
  embedText: 6000,
  embeds: 10,
  fieldName: 256,
  fieldValue: 1024,
  fields: 25,
  footerText: 2048,
  title: 256,
  username: 80,
};

export interface NormalizedEmbedResult {
  droppedFields: number;
  embed: APIEmbed;
  truncated: boolean;
}

export function validateDiscordWebhookPayload(payload: DiscordWebhookPayload): void {
  if (payload.username && payload.username.length > DISCORD_LIMITS.username) {
    throw new DaisyTrackerError(
      `Discord webhook username exceeds ${DISCORD_LIMITS.username} characters.`,
      { kind: "internal" },
    );
  }

  if (!payload.embeds.length) {
    throw new DaisyTrackerError("Discord webhook payload must contain at least one embed.", {
      kind: "internal",
    });
  }

  if (payload.embeds.length > DISCORD_LIMITS.embeds) {
    throw new DaisyTrackerError(
      `Discord webhook payload exceeds ${DISCORD_LIMITS.embeds} embeds.`,
      {
        kind: "internal",
      },
    );
  }

  const total = payload.embeds.reduce((sum, embed) => sum + validateEmbed(embed), 0);
  if (total > DISCORD_LIMITS.embedText) {
    throw new DaisyTrackerError(
      `Discord webhook embed text exceeds ${DISCORD_LIMITS.embedText} characters.`,
      { kind: "internal" },
    );
  }
}

export function normalizeEmbed(embed: APIEmbed): APIEmbed {
  return normalizeEmbedWithMetadata(embed).embed;
}

export function normalizeEmbedWithMetadata(embed: APIEmbed): NormalizedEmbedResult {
  let truncated = false;
  let droppedFields = Math.max(0, (embed.fields || []).length - DISCORD_LIMITS.fields);

  const fields = (embed.fields || []).slice(0, DISCORD_LIMITS.fields).map((field) => ({
    inline: Boolean(field.inline),
    name: truncateWithMetadata(field.name || "Field", DISCORD_LIMITS.fieldName),
    value: truncateWithMetadata(field.value || "_No content_", DISCORD_LIMITS.fieldValue),
  }));

  const normalized: APIEmbed = {
    ...embed,
    author: embed.author?.name
      ? {
          ...embed.author,
          name: truncateWithMetadata(embed.author.name, DISCORD_LIMITS.authorName),
        }
      : embed.author,
    description: embed.description
      ? truncateWithMetadata(embed.description, DISCORD_LIMITS.description)
      : undefined,
    fields,
    footer: embed.footer?.text
      ? {
          ...embed.footer,
          text: truncateWithMetadata(embed.footer.text, DISCORD_LIMITS.footerText),
        }
      : embed.footer,
    title: embed.title ? truncateWithMetadata(embed.title, DISCORD_LIMITS.title) : undefined,
  };

  while (embedTextLength(normalized) > DISCORD_LIMITS.embedText && normalized.fields?.length) {
    normalized.fields.pop();
    droppedFields += 1;
  }

  if (embedTextLength(normalized) > DISCORD_LIMITS.embedText && normalized.description) {
    normalized.description = truncateWithMetadata(
      normalized.description,
      Math.max(
        0,
        DISCORD_LIMITS.description - (embedTextLength(normalized) - DISCORD_LIMITS.embedText) - 16,
      ),
    );
  }

  return { droppedFields, embed: normalized, truncated };

  function truncateWithMetadata(value: string, limit: number): string {
    if (value.length > limit) {
      truncated = true;
    }

    return truncate(value, limit);
  }
}

export function canAddField(embed: APIEmbed, field: APIEmbedField): boolean {
  const next: APIEmbed = {
    ...embed,
    fields: [...(embed.fields || []), field],
  };

  return (
    (next.fields?.length || 0) <= DISCORD_LIMITS.fields &&
    embedTextLength(next) <= DISCORD_LIMITS.embedText
  );
}

export function embedTextLength(embed: APIEmbed): number {
  return [
    embed.title || "",
    embed.description || "",
    embed.footer?.text || "",
    embed.author?.name || "",
    ...(embed.fields || []).flatMap((field) => [field.name || "", field.value || ""]),
  ].reduce((total, value) => total + value.length, 0);
}

export function appendFooterNote(embed: APIEmbed, note: string): void {
  const existing = embed.footer?.text || "";
  embed.footer = {
    ...(embed.footer || {}),
    text: truncate(existing ? `${existing} | ${note}` : note, DISCORD_LIMITS.footerText),
  };
}

export function truncate(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, Math.max(0, limit - 3))}...`;
}

function validateEmbed(embed: APIEmbed): number {
  if (embed.title && embed.title.length > DISCORD_LIMITS.title) {
    throw new DaisyTrackerError(`Discord embed title exceeds ${DISCORD_LIMITS.title} characters.`, {
      kind: "internal",
    });
  }
  if (embed.description && embed.description.length > DISCORD_LIMITS.description) {
    throw new DaisyTrackerError(
      `Discord embed description exceeds ${DISCORD_LIMITS.description} characters.`,
      { kind: "internal" },
    );
  }
  if (embed.author?.name && embed.author.name.length > DISCORD_LIMITS.authorName) {
    throw new DaisyTrackerError(
      `Discord embed author exceeds ${DISCORD_LIMITS.authorName} characters.`,
      { kind: "internal" },
    );
  }
  if (embed.footer?.text && embed.footer.text.length > DISCORD_LIMITS.footerText) {
    throw new DaisyTrackerError(
      `Discord embed footer exceeds ${DISCORD_LIMITS.footerText} characters.`,
      { kind: "internal" },
    );
  }
  if ((embed.fields || []).length > DISCORD_LIMITS.fields) {
    throw new DaisyTrackerError(`Discord embed exceeds ${DISCORD_LIMITS.fields} fields.`, {
      kind: "internal",
    });
  }

  for (const field of embed.fields || []) {
    if (!field.name || !field.value) {
      throw new DaisyTrackerError("Discord embed fields must include non-empty name and value.", {
        kind: "internal",
      });
    }
    if (field.name.length > DISCORD_LIMITS.fieldName) {
      throw new DaisyTrackerError(
        `Discord embed field name exceeds ${DISCORD_LIMITS.fieldName} characters.`,
        { kind: "internal" },
      );
    }
    if (field.value.length > DISCORD_LIMITS.fieldValue) {
      throw new DaisyTrackerError(
        `Discord embed field value exceeds ${DISCORD_LIMITS.fieldValue} characters.`,
        { kind: "internal" },
      );
    }
  }

  return embedTextLength(embed);
}
