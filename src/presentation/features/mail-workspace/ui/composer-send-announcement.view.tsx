export const ComposerSendAnnouncementView = ({
  announcement,
}: {
  readonly announcement: string;
}) => (
  <span aria-atomic="true" aria-live="polite" className="sr-only" role="status">
    {announcement}
  </span>
);
