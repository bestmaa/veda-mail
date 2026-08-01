import { LABEL_COLORS } from "@/domain/mail/label";
import { normalizeLabelName } from "@/domain/mail/label-policy";
import { id } from "@/domain/shared/brand";
import { z } from "zod";

const labelNameSchema = z.string().trim().min(1).max(100).superRefine((value, context) => {
  try {
    normalizeLabelName(value);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "Invalid label name.",
    });
  }
});
const labelIdSchema = z.string()
  .regex(/^veda-label-[a-z2-7]{26}$/u)
  .transform(id.label);

export const createLabelSchema = z.object({
  color: z.enum(LABEL_COLORS),
  name: labelNameSchema,
}).strict();

export const updateLabelSchema = z.object({
  color: z.enum(LABEL_COLORS).optional(),
  labelId: labelIdSchema,
  name: labelNameSchema.optional(),
}).strict().refine(({ color, name }) => color !== undefined || name !== undefined);

export const deleteLabelSchema = z.object({
  labelId: labelIdSchema,
}).strict();
