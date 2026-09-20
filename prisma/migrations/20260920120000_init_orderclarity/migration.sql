-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "installationGeneration" INTEGER NOT NULL DEFAULT 1,
    "mode" TEXT NOT NULL DEFAULT 'observation',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" TEXT NOT NULL DEFAULT 'active',
    "onboardingStep" TEXT NOT NULL DEFAULT 'install',
    "onboardingJson" TEXT NOT NULL DEFAULT '{}',
    "selectedProductGidsJson" TEXT NOT NULL DEFAULT '[]',
    "collectionGid" TEXT,
    "collectionNeedsReview" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Shop_domain_key" ON "Shop"("domain");

CREATE TABLE "Installation" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "Installation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Installation_shopId_generation_key" ON "Installation"("shopId", "generation");

CREATE TABLE "AppUser" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "verifiedStaffId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AppUser_shopId_verifiedStaffId_key" ON "AppUser"("shopId", "verifiedStaffId");

CREATE TABLE "ProductMapping" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "productGidsJson" TEXT NOT NULL,
    "collectionGid" TEXT,
    "entriesJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductMapping_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductMapping_shopId_scope_version_key" ON "ProductMapping"("shopId", "scope", "version");

CREATE TABLE "RuleSet" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "policyJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RuleSet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RuleSet_shopId_scope_version_key" ON "RuleSet"("shopId", "scope", "version");

CREATE TABLE "OrderRecord" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "currentSnapshotId" TEXT,
    "currentEvaluationId" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "processingState" TEXT NOT NULL DEFAULT 'queued',
    "overallLabel" TEXT,
    "uncheckedReason" TEXT,
    "humanReview" TEXT NOT NULL DEFAULT 'not_reviewed',
    "assignee" TEXT,
    "lastEvaluatedAt" TIMESTAMP(3),
    "contentHash" TEXT,
    "customerId" TEXT,
    "lifecycle" TEXT NOT NULL DEFAULT 'active',
    "productSummary" TEXT NOT NULL DEFAULT '',
    "primaryReason" TEXT,
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "snapshotRevision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrderRecord_shopId_orderGid_key" ON "OrderRecord"("shopId", "orderGid");

CREATE TABLE "OrderSnapshot" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "encryptedPayload" TEXT,
    CONSTRAINT "OrderSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrderSnapshot_orderId_revision_key" ON "OrderSnapshot"("orderId", "revision");

CREATE TABLE "Evaluation" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "mappingVersion" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "evaluationVersion" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "state" TEXT NOT NULL,
    "overallLabel" TEXT NOT NULL,
    "uncheckedReason" TEXT,
    "encryptedRequest" TEXT,
    "encryptedResponse" TEXT,
    "current" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "itemRef" TEXT,
    "sourceRefsJson" TEXT NOT NULL,
    "evidenceJson" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "uncertain" BOOLEAN NOT NULL DEFAULT false,
    "templateId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "humanReview" TEXT NOT NULL,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "winningProbability" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Finding_evaluationId_fingerprint_key" ON "Finding"("evaluationId", "fingerprint");

CREATE TABLE "ReviewEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "findingId" TEXT,
    "orderId" TEXT NOT NULL,
    "actorStaffId" TEXT,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActionOutbox" (
    "actionKey" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "actionType" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    CONSTRAINT "ActionOutbox_pkey" PRIMARY KEY ("actionKey")
);

CREATE TABLE "WebhookReceipt" (
    "shopId" TEXT NOT NULL,
    "installationGeneration" INTEGER NOT NULL,
    "eventId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "WebhookReceipt_shopId_installationGeneration_eventId_key" ON "WebhookReceipt"("shopId", "installationGeneration", "eventId");

CREATE TABLE "UsageLedger" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "UsageLedger_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UsageLedger_shopId_cycleId_orderGid_key" ON "UsageLedger"("shopId", "cycleId", "orderGid");

CREATE TABLE "Subscription" (
    "shopId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "entitlement" INTEGER NOT NULL,
    "cycleId" TEXT NOT NULL,
    "cycleStart" TIMESTAMP(3) NOT NULL,
    "cycleEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "graceUntil" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("shopId")
);

CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "actorStaffId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "revision" INTEGER,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "installationGeneration" INTEGER NOT NULL,
    "orderGid" TEXT,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "runAfter" BIGINT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leasedUntil" BIGINT,
    "status" TEXT NOT NULL,
    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);
