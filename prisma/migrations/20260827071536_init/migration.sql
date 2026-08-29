-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "pictureUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Bill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "splitMode" TEXT NOT NULL DEFAULT 'EQUAL',
    "totalSatang" INTEGER,
    "accountName" TEXT,
    "accountNumber" TEXT,
    "bankName" TEXT,
    "qrImagePath" TEXT,
    "recurrence" TEXT NOT NULL DEFAULT 'NONE',
    "interval" INTEGER NOT NULL DEFAULT 1,
    "repeatCount" INTEGER,
    "startDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN_JOIN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Bill_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Bill_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "customSatang" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Participant_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Participant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BillCycle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billId" TEXT NOT NULL,
    "cycleNo" INTEGER NOT NULL DEFAULT 1,
    "dueDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COLLECTING',
    "lastRemindedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillCycle_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Charge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cycleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountSatang" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNPAID',
    "method" TEXT,
    "slipImagePath" TEXT,
    "paidAt" DATETIME,
    "confirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Charge_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "BillCycle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Charge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SlipUploadState" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "chargeId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Bill_groupId_status_idx" ON "Bill"("groupId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_billId_userId_key" ON "Participant"("billId", "userId");

-- CreateIndex
CREATE INDEX "BillCycle_status_dueDate_idx" ON "BillCycle"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "BillCycle_billId_cycleNo_key" ON "BillCycle"("billId", "cycleNo");

-- CreateIndex
CREATE INDEX "Charge_status_idx" ON "Charge"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_cycleId_userId_key" ON "Charge"("cycleId", "userId");
