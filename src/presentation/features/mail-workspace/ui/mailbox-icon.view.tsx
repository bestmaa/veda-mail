import {
  Archive,
  FilePenLine,
  Folder,
  Inbox,
  Send,
  ShieldAlert,
  Trash2,
} from "lucide-react";

import type { MailboxIconName } from "@/presentation/features/mail-workspace/mail-workspace.view-model";

interface MailboxIconViewProps {
  readonly icon: MailboxIconName;
  readonly size?: number;
}

export const MailboxIconView = ({
  icon,
  size = 18,
}: MailboxIconViewProps) => {
  const props = { "aria-hidden": true, size, strokeWidth: 1.9 };
  if (icon === "inbox") {
    return <Inbox {...props} />;
  }
  if (icon === "sent") {
    return <Send {...props} />;
  }
  if (icon === "drafts") {
    return <FilePenLine {...props} />;
  }
  if (icon === "archive") {
    return <Archive {...props} />;
  }
  if (icon === "spam") {
    return <ShieldAlert {...props} />;
  }
  if (icon === "trash") {
    return <Trash2 {...props} />;
  }
  return <Folder {...props} />;
};
