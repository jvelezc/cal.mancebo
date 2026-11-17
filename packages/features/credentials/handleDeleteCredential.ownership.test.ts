import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  membership: { findFirst: vi.fn() },
  credential: { findFirst: vi.fn(), delete: vi.fn() },
  eventType: { findMany: vi.fn(), update: vi.fn() },
  destinationCalendar: { findUnique: vi.fn(), delete: vi.fn() },
  selectedCalendar: { deleteMany: vi.fn() },
  apiKey: { deleteMany: vi.fn() },
  webhook: { deleteMany: vi.fn() },
}));
vi.mock("@calcom/prisma", () => ({ prisma: db, bookingMinimalSelect: {} }));
vi.mock("@calcom/prisma/selects/credential", () => ({ credentialForCalendarServiceSelect: {} }));
vi.mock("@calcom/prisma/enums", () => ({
  AppCategories: {
    video: "video",
    conferencing: "conferencing",
    calendar: "calendar",
    crm: "crm",
    payment: "payment",
  },
  BookingStatus: { CANCELLED: "CANCELLED" },
}));
vi.mock("@calcom/prisma/zod-utils", () => ({
  EventTypeMetaDataSchema: { parse: () => ({}) },
  userMetadata: { parse: () => ({}) },
}));
vi.mock("@calcom/app-store/_utils/getCalendar", () => ({ getCalendar: vi.fn() }));
vi.mock("@calcom/app-store/appStoreMetaData", () => ({ appStoreMetadata: {} }));
vi.mock("@calcom/app-store/locations", () => ({ DailyLocationType: "integrations:daily" }));
vi.mock("@calcom/app-store/zod-utils", () => ({
  eventTypeAppMetadataOptionalSchema: {},
  eventTypeMetaDataSchemaWithTypedApps: {},
}));
vi.mock("@calcom/emails/email-manager", () => ({ sendCancelledEmailsAndSMS: vi.fn() }));
vi.mock("@calcom/features/bookings/lib/getCalEventResponses", () => ({ getCalEventResponses: vi.fn() }));
vi.mock("@calcom/features/bookings/lib/payment/deletePayment", () => ({ deletePayment: vi.fn() }));
vi.mock("@calcom/features/webhooks/lib/scheduleTrigger", () => ({ deleteWebhookScheduledTriggers: vi.fn() }));
vi.mock("@calcom/lib/delegationCredential", () => ({ buildNonDelegationCredential: vi.fn() }));
vi.mock("@calcom/lib/isPrismaObj", () => ({ isPrismaObjOrUndefined: vi.fn() }));
vi.mock("@calcom/lib/isRecurringEvent", () => ({ parseRecurringEvent: vi.fn() }));
vi.mock("@calcom/i18n/server", () => ({ getTranslation: vi.fn() }));
import handleDeleteCredential from "./handleDeleteCredential";

type OwnedRow = { userId?: number | null; teamId?: number | null; parent?: { teamId: number } | null };
type Filter = { userId?: number; teamId?: number | null; parent?: { teamId?: number } };
function matches(row: OwnedRow, filter: Filter) {
  return (
    (filter.userId === undefined || row.userId === filter.userId) &&
    (filter.teamId === undefined || row.teamId === filter.teamId) &&
    (!filter.parent ||
      (!!row.parent && (filter.parent.teamId === undefined || row.parent.teamId === filter.parent.teamId)))
  );
}
const events = [
  { id: 1, userId: 10, teamId: null, parent: null },
  { id: 2, userId: 20, teamId: null, parent: { teamId: 300 } },
  { id: 3, userId: 10, teamId: 300, parent: null },
  { id: 4, userId: 20, teamId: 100, parent: null },
  { id: 5, userId: 20, teamId: null, parent: { teamId: 100 } },
];
const personal = {
  id: 7,
  userId: 10,
  teamId: null,
  type: "zoom_video",
  appId: "zoomvideo",
  app: { slug: "zoomvideo", categories: ["video"] },
};
const remove = (teamId?: number) => handleDeleteCredential({ userId: 10, credentialId: 7, teamId });

describe("connection deletion ownership", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.credential.findFirst.mockImplementation(async ({ where }) =>
      matches(personal, where) ? personal : null
    );
    db.eventType.findMany.mockImplementation(async ({ where }: { where: { OR: Filter[] } }) =>
      events
        .filter((event) => where.OR.some((filter) => matches(event, filter)))
        .map((event) => ({ ...event, locations: [{ type: "integrations:zoom" }], metadata: {} }))
    );
  });

  it("disconnects a personal connection without changing another user's managed events or team events", async () => {
    await remove();
    expect(db.eventType.update.mock.calls.map(([arg]) => arg.where.id)).toEqual([1]);
    expect(db.credential.delete).toHaveBeenCalledExactlyOnceWith({
      where: { id: 7, userId: 10, teamId: null },
    });
    expect(db.membership.findFirst).not.toHaveBeenCalled();
  });

  it("refuses another user's personal connection before reading or changing event types", async () => {
    db.credential.findFirst.mockResolvedValue(null);
    await expect(remove()).rejects.toMatchObject({ code: "not_found_error" });
    expect(db.credential.findFirst.mock.calls[0][0].where).toEqual({ id: 7, userId: 10, teamId: null });
    expect(db.eventType.findMany).not.toHaveBeenCalled();
    expect(db.credential.delete).not.toHaveBeenCalled();
  });

  it("cannot disconnect a team connection by omitting its team scope even when its user id matches", async () => {
    db.credential.findFirst.mockImplementation(async ({ where }) =>
      matches({ ...personal, teamId: 300 }, where) ? personal : null
    );
    await expect(remove()).rejects.toMatchObject({ code: "not_found_error" });
    expect(db.eventType.findMany).not.toHaveBeenCalled();
    expect(db.credential.delete).not.toHaveBeenCalled();
  });

  it("denies an unaccepted, ordinary or unrelated team member before accessing the team's connection", async () => {
    db.membership.findFirst.mockResolvedValue(null);
    await expect(remove(100)).rejects.toMatchObject({ code: "forbidden_error" });
    expect(db.membership.findFirst).toHaveBeenCalledExactlyOnceWith({
      where: { userId: 10, teamId: 100, accepted: true, role: { in: ["ADMIN", "OWNER"] } },
      select: { id: true },
    });
    expect(db.credential.findFirst).not.toHaveBeenCalled();
    expect(db.eventType.findMany).not.toHaveBeenCalled();
    expect(db.credential.delete).not.toHaveBeenCalled();
  });

  it("allows a current team administrator to change only that team's direct and managed events", async () => {
    db.membership.findFirst.mockResolvedValue({ id: 99 });
    db.credential.findFirst.mockResolvedValue({ ...personal, userId: null, teamId: 100 });
    await remove(100);
    expect(db.credential.findFirst.mock.calls[0][0].where).toEqual({ id: 7, teamId: 100 });
    expect(db.eventType.update.mock.calls.map(([arg]) => arg.where.id)).toEqual([4, 5]);
    expect(db.credential.delete).toHaveBeenCalledExactlyOnceWith({ where: { id: 7, teamId: 100 } });
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid team scope %s without any data access", async (teamId) => {
    await expect(remove(teamId)).rejects.toMatchObject({ code: "bad_request_error" });
    expect(db.membership.findFirst).not.toHaveBeenCalled();
    expect(db.credential.findFirst).not.toHaveBeenCalled();
    expect(db.credential.delete).not.toHaveBeenCalled();
  });

  it("keeps a destination calendar that belongs to another connection with the same provider", async () => {
    db.credential.findFirst.mockResolvedValue({
      ...personal,
      app: { slug: "google-calendar", categories: ["calendar"] },
    });
    db.eventType.findMany.mockResolvedValue([
      { id: 1, destinationCalendar: { id: 50, credential: { id: 8, appId: personal.appId } } },
    ]);
    db.destinationCalendar.findUnique.mockResolvedValue({ id: 50 });
    await remove();
    expect(db.destinationCalendar.delete).not.toHaveBeenCalled();
    expect(db.credential.delete).toHaveBeenCalledTimes(1);
  });

  it("removes a destination calendar that belongs to the disconnected connection", async () => {
    db.credential.findFirst.mockResolvedValue({
      ...personal,
      app: { slug: "google-calendar", categories: ["calendar"] },
    });
    db.eventType.findMany.mockResolvedValue([
      { id: 1, destinationCalendar: { id: 50, credential: { id: 7, appId: personal.appId } } },
    ]);
    db.destinationCalendar.findUnique.mockResolvedValue({ id: 50 });
    await remove();
    expect(db.destinationCalendar.delete).toHaveBeenCalledExactlyOnceWith({ where: { id: 50 } });
    expect(db.selectedCalendar.deleteMany.mock.calls[0][0].where).toMatchObject({
      userId: 10,
      credentialId: 7,
      integration: "zoom_video",
    });
  });
});
