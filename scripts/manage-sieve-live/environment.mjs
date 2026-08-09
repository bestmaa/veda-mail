const SECRET_NAMES = [
  "VEDA_MAIL_ACCEPTANCE_PASSWORD",
  "VEDA_MAIL_ACCEPTANCE_USERNAME",
  "VEDA_MAIL_STALWART_MANAGEMENT_API_KEY",
  "VEDA_MAIL_STALWART_MANAGEMENT_ORIGIN",
];

export const isolatedEnvironment = () => {
  const environment = { ...process.env };
  for (const name of SECRET_NAMES) delete environment[name];
  return environment;
};
