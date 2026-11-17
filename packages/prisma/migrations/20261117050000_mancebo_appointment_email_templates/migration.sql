CREATE TABLE "ManceboAppointmentEmailTemplate" (
    "scopeKey" TEXT NOT NULL,
    "workspaceId" UUID,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "subject" VARCHAR(180) NOT NULL,
    "greeting" VARCHAR(300) NOT NULL,
    "introduction" TEXT NOT NULL,
    "closing" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedByManceboUserId" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManceboAppointmentEmailTemplate_pkey" PRIMARY KEY ("scopeKey"),
    CONSTRAINT "ManceboAppointmentEmailTemplate_scope" CHECK (
        ("scopeKey" = 'platform' AND "workspaceId" IS NULL) OR
        ("workspaceId" IS NOT NULL AND "scopeKey" = "workspaceId"::text)
    ),
    CONSTRAINT "ManceboAppointmentEmailTemplate_content" CHECK (
        "revision" > 0 AND length("introduction") <= 5000 AND length("closing") <= 5000
    )
);

CREATE TABLE "ManceboEventEmailWorkspace" (
    "eventTypeId" INTEGER NOT NULL,
    "workspaceId" UUID NOT NULL,
    "workspaceName" VARCHAR(120) NOT NULL,
    "linkedByManceboUserId" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManceboEventEmailWorkspace_pkey" PRIMARY KEY ("eventTypeId"),
    CONSTRAINT "ManceboEventEmailWorkspace_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ManceboEventEmailWorkspace_workspaceId_idx" ON "ManceboEventEmailWorkspace"("workspaceId");
