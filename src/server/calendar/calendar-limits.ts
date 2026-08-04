export const CALENDAR_LIMITS = {
  attendeesPerEvent: 500,
  components: 128,
  componentDepth: 8,
  descriptionBytes: 65_536,
  eventsPerExport: 1_000,
  exportBytes: 8_388_608,
  inputBytes: 1_048_576,
  logicalLines: 20_000,
  parameterBytes: 2_048,
  parametersPerProperty: 32,
  physicalLines: 20_000,
  propertiesPerEvent: 512,
  propertiesTotal: 2_048,
  recurrenceParts: 32,
  recurrenceValues: 366,
  summaryBytes: 2_048,
  textBytes: 4_096,
  uidBytes: 1_024,
  unfoldedLineBytes: 16_384,
} as const;

export const CALENDAR_PRODUCT_ID = "-//Veda Concepts//Veda Mail//EN";
