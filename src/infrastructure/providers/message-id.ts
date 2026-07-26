import "server-only";

import { randomUUID } from "node:crypto";

export const createMessageId = (sender: string): string => {
  const domain = sender.slice(sender.lastIndexOf("@") + 1).toLowerCase();
  return `${randomUUID()}@${domain}`;
};
