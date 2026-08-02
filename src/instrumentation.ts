export const register = async (): Promise<void> => {
  if (process.env["NEXT_RUNTIME"] !== "nodejs") return;
  const { startScheduledSendWorker } = await import(
    "@/server/scheduled-send/scheduled-send-worker"
  );
  await startScheduledSendWorker();
};
