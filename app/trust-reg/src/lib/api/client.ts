import type {
  Authority,
  BusinessPriority,
  ChecklistItem,
  DocumentRow,
  DocumentType,
  EventRow,
  EventType,
  OverallStatus,
  RequirementDecisionStatus,
  RequirementRow,
  TrustCaseRow,
  TrustCaseWithRequirements,
  UserRole,
} from "@/server/domain/types";
import type { Transition } from "@/server/workflow/requirementStateMachine";
import type { AuditEventRow } from "@/server/services/eventService";

export interface SessionUser {
  id: string;
  email: string;
  role: UserRole;
  fullName?: string;
  wmTeam?: string;
  isActive: boolean;
}

export interface CreateCaseInput {
  insightlyId: string;
  clientDisplayName: string;
  trustName: string;
  providerName: string;
  providerCountry: string;
  trustType: string;
  trustCreationDate?: string;
  requestingWmTeam: string;
  businessPriority: BusinessPriority;
  targetProviderSubmissionDate?: string;
}

export interface ListCasesFilter {
  status?: OverallStatus;
  search?: string;
}

export interface RequirementDecisionInput {
  authority: Authority;
  requirementStatus: RequirementDecisionStatus;
  requirementReason: string;
  registrationDeadline?: string;
  internalTargetDate?: string;
}

export interface PatchRequirementInput {
  assignedTo?: string | null;
  registrationDeadline?: string | null;
  internalTargetDate?: string | null;
  checklist?: ChecklistItem[];
  authorityReference?: string | null;
  completionNotes?: string | null;
}

export interface TransitionInput {
  transition: Transition;
  comment?: string;
  authorityReference?: string;
  rejectionReason?: string;
  completionNotes?: string;
}

export interface UploadDocumentInput {
  registrationRequirementId: string;
  documentType: DocumentType;
  file: File;
}

export interface VerifyDocumentInput {
  verificationStatus: "verified" | "rejected";
  rejectionReason?: string;
}

export interface DownloadLink {
  url: string;
  expiresAt: string;
  fileName: string;
}

export interface CaseCommentInput {
  comment?: string;
}

export interface ListEventsFilter {
  type?: EventType;
  caseId?: string;
  from?: string;
  to?: string;
}

export type { AuditEventRow };

// One interface, two implementations: mockClient (in-browser, no backend) and httpClient (the /api routes).
export interface TrustRegApi {
  readonly mode: "mock" | "http";
  me(): Promise<SessionUser | null>;
  listCases(filter?: ListCasesFilter): Promise<TrustCaseWithRequirements[]>;
  getCase(id: string): Promise<TrustCaseWithRequirements>;
  createCase(input: CreateCaseInput): Promise<TrustCaseRow>;
  handBackToWm(caseId: string, input?: CaseCommentInput): Promise<TrustCaseRow>;
  closeCase(caseId: string, input?: CaseCommentInput): Promise<TrustCaseRow>;
  setRequirementDecision(caseId: string, input: RequirementDecisionInput): Promise<RequirementRow>;
  patchRequirement(requirementId: string, input: PatchRequirementInput): Promise<RequirementRow>;
  transition(requirementId: string, input: TransitionInput): Promise<RequirementRow>;
  listDocuments(requirementId: string): Promise<DocumentRow[]>;
  uploadDocument(input: UploadDocumentInput): Promise<DocumentRow>;
  verifyDocument(documentId: string, input: VerifyDocumentInput): Promise<DocumentRow>;
  getDocumentDownload(documentId: string): Promise<DownloadLink>;
  listEvents(caseId: string): Promise<EventRow[]>;
  listAllEvents(filter?: ListEventsFilter): Promise<AuditEventRow[]>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}
