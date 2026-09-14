import { z } from "zod";
import {
  AUTHORITIES,
  BUSINESS_PRIORITIES,
  DOCUMENT_TYPES,
  EVENT_TYPES,
  OVERALL_STATUSES,
  REQUIREMENT_DECISION_STATUSES,
} from "@/server/domain/types";
import { TRANSITIONS } from "@/server/workflow/requirementStateMachine";

const isoDate = z.coerce.date();
const optionalDate = isoDate.optional();
const nullableDate = isoDate.nullable().optional();

export const createTrustCaseSchema = z.object({
  insightlyId: z.string().min(1),
  clientDisplayName: z.string().min(1),
  trustName: z.string().min(1),
  providerName: z.string().min(1),
  providerCountry: z.string().min(2),
  trustType: z.string().min(1),
  trustCreationDate: optionalDate,
  requestingWmTeam: z.string().min(1),
  businessPriority: z.enum(BUSINESS_PRIORITIES).default("standard"),
  targetProviderSubmissionDate: optionalDate,
});

export const listTrustCasesSchema = z.object({
  status: z.enum(OVERALL_STATUSES).optional(),
  wmTeam: z.string().optional(),
  assignedAepUserId: z.string().uuid().optional(),
  search: z.string().optional(),
});

export const patchTrustCaseSchema = z.object({
  assignedAepUserId: z.string().uuid().nullable(),
});

export const deleteTrustCaseSchema = z.object({
  reason: z.string().min(3),
});

export const requirementDecisionSchema = z.object({
  authority: z.enum(AUTHORITIES),
  requirementStatus: z.enum(REQUIREMENT_DECISION_STATUSES),
  requirementReason: z.string().min(1),
  complianceRuleId: z.string().uuid().optional(),
  registrationDeadline: optionalDate,
  internalTargetDate: optionalDate,
});

export const checklistItemSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  completed: z.boolean(),
});

export const patchRequirementSchema = z.object({
  assignedTo: z.string().uuid().nullable().optional(),
  registrationDeadline: nullableDate,
  internalTargetDate: nullableDate,
  checklist: z.array(checklistItemSchema).optional(),
  authorityReference: z.string().nullable().optional(),
  completionNotes: z.string().nullable().optional(),
});

export const transitionSchema = z.object({
  transition: z.enum(TRANSITIONS),
  comment: z.string().optional(),
  authorityReference: z.string().optional(),
  rejectionReason: z.string().optional(),
  completionNotes: z.string().optional(),
});

// Multipart fields that accompany the file itself.
export const uploadDocumentFieldsSchema = z.object({
  registrationRequirementId: z.string().uuid(),
  documentType: z.enum(DOCUMENT_TYPES),
});

export const caseCommentSchema = z.object({
  comment: z.string().trim().max(2000).optional(),
});

export const listEventsSchema = z.object({
  type: z.enum(EVENT_TYPES).optional(),
  caseId: z.string().uuid().optional(),
  from: optionalDate,
  to: optionalDate,
  format: z.enum(["json", "csv"]).default("json"),
});

export const verifyDocumentSchema = z
  .object({
    verificationStatus: z.enum(["verified", "rejected"]),
    rejectionReason: z.string().optional(),
  })
  .refine((v) => v.verificationStatus === "verified" || (v.rejectionReason ?? "").trim().length > 0, {
    message: "rejectionReason is required when rejecting",
    path: ["rejectionReason"],
  });
