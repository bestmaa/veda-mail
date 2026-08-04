export const register = async (): Promise<void> => {
  if (process.env["NEXT_RUNTIME"] !== "nodejs") return;
  const { installProviderSnoozeOperationAdapter } = await import(
    "./server/snooze/provider-snooze-operation.adapter"
  );
  installProviderSnoozeOperationAdapter();
  const { startScheduledSendWorker } = await import(
    "./server/scheduled-send/scheduled-send-worker"
  );
  await startScheduledSendWorker();
  const { startSnoozeWorker } = await import(
    "./server/snooze/snooze-worker"
  );
  await startSnoozeWorker().catch(() => {
    console.error("[veda-mail] Snooze worker did not start.");
  });
};
