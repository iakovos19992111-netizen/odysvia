"use server";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  authenticate,
  clearAdminSession,
  createAdminSession,
  requireAdmin,
} from "@/lib/auth";
import { audit, db, ensureDatabase } from "@/lib/db";
const val = (f: FormData, k: string) => String(f.get(k) || "").trim();
const now = () => new Date().toISOString();
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const fail = (path: string, message: string): never =>
  redirect(`${path}?error=${encodeURIComponent(message)}`);
const refresh = () => {
  revalidatePath("/admin");
  revalidatePath("/stays");
};
export async function loginAction(_: unknown, form: FormData) {
  const email = val(form, "email"),
    password = val(form, "password");
  if (!(await authenticate(email, password)))
    return { error: "Invalid Admin credentials." };
  await createAdminSession(email);
  redirect("/admin");
}
export async function logoutAction() {
  await clearAdminSession();
  redirect("/admin/login");
}
export async function updateRequestAction(form: FormData) {
  const admin = await requireAdmin();
  await ensureDatabase();
  const id = val(form, "id"),
    intent = val(form, "intent"),
    request = (
      await db.execute({
        sql: "SELECT * FROM booking_requests WHERE id=? AND status='pending'",
        args: [id],
      })
    ).rows[0];
  if (!request)
    fail("/admin/booking-requests", "The request is no longer pending.");
  const stamp = now();
  try {
    if (intent === "reject")
      await db.execute({
        sql: "UPDATE booking_requests SET status='rejected',updated_at=? WHERE id=?",
        args: [stamp, id],
      });
    else {
      if (request.kind !== "stay" || !request.property_id || !request.check_out)
        fail(
          "/admin/booking-requests",
          "Only complete stay requests can become reservations.",
        );
      const available = (
        await db.execute({
          sql: "SELECT id FROM properties WHERE id=? AND status='published' AND archived_at IS NULL",
          args: [request.property_id],
        })
      ).rows[0];
      if (!available)
        fail(
          "/admin/booking-requests",
          "This property is not currently published.",
        );
      const reservationId = randomUUID(),
        reference = `RES-${reservationId.slice(0, 8).toUpperCase()}`;
      await db.batch(
        [
          {
            sql: "INSERT INTO reservations(id,reference,property_id,guest_id,booking_request_id,check_in,check_out,guests,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?, 'confirmed',?,?)",
            args: [
              reservationId,
              reference,
              request.property_id,
              request.guest_id,
              id,
              request.check_in,
              request.check_out,
              request.guests,
              stamp,
              stamp,
            ],
          },
          {
            sql: "UPDATE booking_requests SET status='approved',updated_at=? WHERE id=?",
            args: [stamp, id],
          },
          {
            sql: "INSERT INTO notifications(id,type,title,message,entity_type,entity_id,created_at) VALUES(?,'reservation','Reservation confirmed',?,'reservation',?,?)",
            args: [
              randomUUID(),
              `${reference} created from ${request.reference}`,
              reservationId,
              stamp,
            ],
          },
        ],
        "write",
      );
      await audit(admin.email, "approve_request", "booking_request", id, {
        reservationId,
      });
    }
  } catch (e) {
    const message =
      e instanceof Error && /overlap/i.test(e.message)
        ? "Those dates overlap a reservation or blocked period."
        : "The request could not be updated.";
    fail("/admin/booking-requests", message);
  }
  if (intent === "reject")
    await audit(admin.email, "reject_request", "booking_request", id);
  refresh();
  redirect("/admin/booking-requests?success=Request updated");
}
const reservationSchema = z
  .object({
    id: z.string().optional(),
    propertyId: z.string().min(1),
    guestId: z.string().min(1),
    checkIn: z.string().date(),
    checkOut: z.string().date(),
    guests: z.coerce.number().int().min(1).max(30),
    total: z.coerce.number().int().min(0),
    status: z.enum(["draft", "confirmed", "cancelled"]).default("confirmed"),
    notes: z.string().max(2000).default(""),
  })
  .refine((v) => v.checkOut > v.checkIn, {
    message: "Check-out must be after check-in",
  });
export async function saveReservationAction(form: FormData) {
  const admin = await requireAdmin();
  await ensureDatabase();
  const parsed = reservationSchema.safeParse({
    id: val(form, "id") || undefined,
    propertyId: val(form, "propertyId"),
    guestId: val(form, "guestId"),
    checkIn: val(form, "checkIn"),
    checkOut: val(form, "checkOut"),
    guests: form.get("guests"),
    total: form.get("total") || 0,
    status: val(form, "status") || "confirmed",
    notes: val(form, "notes"),
  });
  if (!parsed.success)
    fail(
      "/admin/reservations",
      parsed.error.issues[0]?.message || "Invalid reservation details.",
    );
  const d = parsed.data!,
    stamp = now(),
    id = d.id || randomUUID();
  try {
    if (d.id)
      await db.execute({
        sql: "UPDATE reservations SET property_id=?,guest_id=?,check_in=?,check_out=?,guests=?,total_amount=?,status=?,notes=?,updated_at=? WHERE id=?",
        args: [
          d.propertyId,
          d.guestId,
          d.checkIn,
          d.checkOut,
          d.guests,
          d.total,
          d.status,
          d.notes,
          stamp,
          id,
        ],
      });
    else
      await db.execute({
        sql: "INSERT INTO reservations(id,reference,property_id,guest_id,check_in,check_out,guests,total_amount,status,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        args: [
          id,
          `RES-${id.slice(0, 8).toUpperCase()}`,
          d.propertyId,
          d.guestId,
          d.checkIn,
          d.checkOut,
          d.guests,
          d.total,
          d.status,
          d.notes,
          stamp,
          stamp,
        ],
      });
    await audit(
      admin.email,
      d.id ? "update_reservation" : "create_reservation",
      "reservation",
      id,
      { status: d.status, checkIn: d.checkIn, checkOut: d.checkOut },
    );
  } catch (e) {
    fail(
      "/admin/reservations",
      e instanceof Error && /overlap/i.test(e.message)
        ? "Dates overlap a confirmed reservation or blocked period."
        : "Reservation could not be saved.",
    );
  }
  refresh();
  redirect("/admin/reservations?success=Reservation saved");
}
export async function cancelReservationAction(form: FormData) {
  const admin = await requireAdmin();
  await ensureDatabase();
  const id = val(form, "id");
  await db.execute({
    sql: "UPDATE reservations SET status='cancelled',updated_at=? WHERE id=?",
    args: [now(), id],
  });
  await audit(admin.email, "cancel_reservation", "reservation", id);
  refresh();
  redirect("/admin/reservations?success=Reservation cancelled");
}
const propertySchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(120),
  location: z.string().min(2).max(160),
  region: z.string().min(2).max(80),
  price: z.coerce.number().int().min(0),
  guests: z.coerce.number().int().min(1).max(50),
  beds: z.coerce.number().int().min(0).max(50),
  baths: z.coerce.number().int().min(0).max(50),
  description: z.string().min(20).max(5000),
  status: z.enum(["draft", "published"]),
  amenities: z.array(z.string()).max(50),
});
async function propertyImages(form: FormData) {
  let images: string[] = [];
  try {
    images = JSON.parse(val(form, "existingImages") || "[]");
  } catch {}
  images.push(
    ...val(form, "imageUrls")
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter((x) => /^https:\/\//.test(x)),
  );
  for (const item of form.getAll("images")) {
    if (!(item instanceof File) || !item.size) continue;
    if (item.size > 2_000_000)
      throw new Error("Each image must be smaller than 2 MB.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(item.type))
      throw new Error("Images must be JPEG, PNG or WebP.");
    images.push(
      `data:${item.type};base64,${Buffer.from(await item.arrayBuffer()).toString("base64")}`,
    );
  }
  if (images.length > 12)
    throw new Error("A property can contain up to 12 images.");
  return images;
}
export async function savePropertyAction(form: FormData) {
  const admin = await requireAdmin();
  await ensureDatabase();
  const id = val(form, "id") || undefined,
    name = val(form, "name");
  const parsed = propertySchema.safeParse({
    id,
    name,
    slug: slugify(val(form, "slug") || name),
    location: val(form, "location"),
    region: val(form, "region"),
    price: form.get("price"),
    guests: form.get("guests"),
    beds: form.get("beds"),
    baths: form.get("baths"),
    description: val(form, "description"),
    status: val(form, "status"),
    amenities: val(form, "amenities")
      .split(/\r?\n|,/)
      .map((x) => x.trim())
      .filter(Boolean),
  });
  if (!parsed.success)
    fail(
      "/admin/properties",
      parsed.error.issues[0]?.message || "Invalid property details.",
    );
  let images: string[] = [];
  try {
    images = await propertyImages(form);
  } catch (e) {
    fail(
      "/admin/properties",
      e instanceof Error ? e.message : "Invalid images.",
    );
  }
  const d = parsed.data!,
    stamp = now(),
    entityId = id || randomUUID();
  try {
    if (id)
      await db.execute({
        sql: "UPDATE properties SET slug=?,name=?,location=?,region=?,status=?,price=?,guests=?,beds=?,baths=?,description=?,amenities=?,images=?,updated_at=?,archived_at=NULL WHERE id=?",
        args: [
          d.slug,
          d.name,
          d.location,
          d.region,
          d.status,
          d.price,
          d.guests,
          d.beds,
          d.baths,
          d.description,
          JSON.stringify(d.amenities),
          JSON.stringify(images),
          stamp,
          id,
        ],
      });
    else
      await db.execute({
        sql: "INSERT INTO properties(id,slug,name,location,region,status,price,guests,beds,baths,description,amenities,images,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        args: [
          entityId,
          d.slug,
          d.name,
          d.location,
          d.region,
          d.status,
          d.price,
          d.guests,
          d.beds,
          d.baths,
          d.description,
          JSON.stringify(d.amenities),
          JSON.stringify(images),
          stamp,
          stamp,
        ],
      });
    await audit(
      admin.email,
      id ? "update_property" : "create_property",
      "property",
      entityId,
      { status: d.status },
    );
  } catch (e) {
    fail(
      "/admin/properties",
      e instanceof Error && /UNIQUE/i.test(e.message)
        ? "That property slug is already in use."
        : "Property could not be saved.",
    );
  }
  refresh();
  redirect("/admin/properties?success=Property saved");
}
export async function archivePropertyAction(form: FormData) {
  const admin = await requireAdmin();
  await ensureDatabase();
  const id = val(form, "id"),
    active = Number(
      (
        await db.execute({
          sql: "SELECT COUNT(*) count FROM reservations WHERE property_id=? AND status='confirmed' AND check_out>=date('now')",
          args: [id],
        })
      ).rows[0]?.count || 0,
    );
  if (active)
    fail(
      "/admin/properties",
      "Cancel future confirmed reservations before archiving this property.",
    );
  await db.execute({
    sql: "UPDATE properties SET status='draft',archived_at=?,updated_at=? WHERE id=?",
    args: [now(), now(), id],
  });
  await audit(admin.email, "archive_property", "property", id);
  refresh();
  redirect("/admin/properties?success=Property archived");
}
export async function togglePropertyAction(form: FormData) {
  const admin = await requireAdmin();
  await ensureDatabase();
  const id = val(form, "id");
  await db.execute({
    sql: "UPDATE properties SET status=CASE status WHEN 'published' THEN 'draft' ELSE 'published' END,updated_at=? WHERE id=? AND archived_at IS NULL",
    args: [now(), id],
  });
  await audit(admin.email, "toggle_property_publication", "property", id);
  refresh();
  redirect("/admin/properties");
}
export async function saveGuestAction(form: FormData) {
  const admin = await requireAdmin();
  await ensureDatabase();
  const schema = z.object({
      id: z.string().min(1),
      name: z.string().min(2).max(200),
      email: z.string().email(),
      phone: z.string().min(3).max(50),
      country: z.string().max(100),
      notes: z.string().max(3000),
    }),
    parsed = schema.safeParse({
      id: val(form, "id"),
      name: val(form, "name"),
      email: val(form, "email"),
      phone: val(form, "phone"),
      country: val(form, "country"),
      notes: val(form, "notes"),
    });
  if (!parsed.success)
    fail(
      `/admin/guests/${val(form, "id")}`,
      parsed.error.issues[0]?.message || "Invalid guest details.",
    );
  const d = parsed.data!;
  await db.execute({
    sql: "UPDATE guests SET name=?,email=?,phone=?,country=?,notes=?,updated_at=? WHERE id=?",
    args: [
      d.name,
      d.email.toLowerCase(),
      d.phone,
      d.country,
      d.notes,
      now(),
      d.id,
    ],
  });
  await audit(admin.email, "update_guest", "guest", d.id);
  revalidatePath("/admin/guests");
  redirect(`/admin/guests/${d.id}?success=Guest saved`);
}
export async function addBlockAction(form: FormData) {
  const admin = await requireAdmin();
  await ensureDatabase();
  const start = val(form, "startDate"),
    end = val(form, "endDate"),
    id = randomUUID();
  if (!start || !end || end <= start)
    fail("/admin/availability", "End date must be after start date.");
  try {
    await db.execute({
      sql: "INSERT INTO availability_blocks(id,property_id,start_date,end_date,reason,created_at) VALUES(?,?,?,?,?,?)",
      args: [
        id,
        val(form, "propertyId"),
        start,
        end,
        val(form, "reason"),
        now(),
      ],
    });
    await audit(
      admin.email,
      "create_availability_block",
      "availability_block",
      id,
      { start, end },
    );
  } catch (e) {
    fail(
      "/admin/availability",
      e instanceof Error && /overlap/i.test(e.message)
        ? "Blocked dates overlap a confirmed reservation."
        : "Dates could not be blocked.",
    );
  }
  refresh();
  redirect("/admin/availability?success=Dates blocked");
}
export async function removeBlockAction(form: FormData) {
  const admin = await requireAdmin();
  await ensureDatabase();
  const id = val(form, "id");
  await db.execute({
    sql: "DELETE FROM availability_blocks WHERE id=?",
    args: [id],
  });
  await audit(
    admin.email,
    "remove_availability_block",
    "availability_block",
    id,
  );
  refresh();
  redirect("/admin/availability");
}
export async function markNotificationsReadAction() {
  const admin = await requireAdmin();
  await ensureDatabase();
  await db.execute({
    sql: "UPDATE notifications SET read_at=? WHERE read_at IS NULL",
    args: [now()],
  });
  await audit(admin.email, "mark_notifications_read", "notification", null);
  revalidatePath("/admin");
}
export async function updateSettingsAction(form: FormData) {
  const admin = await requireAdmin();
  await ensureDatabase();
  const stamp = now();
  for (const key of ["platform_name", "timezone", "currency"]) {
    const v = val(form, key);
    if (v)
      await db.execute({
        sql: "INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        args: [key, v, stamp],
      });
  }
  await audit(admin.email, "update_settings", "settings", null);
  revalidatePath("/admin/settings");
  redirect("/admin/settings?success=Settings saved");
}
