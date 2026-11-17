import type { Contact } from "@/hooks/use-device";
import { createGuestInvitation } from "@/lib/emergency-alerts";
import { db, rtdb } from "@/lib/firebase";
import { deleteWrite, setWrite, updateWrite, writeNow } from "@/lib/firestore-rest";
import { ref as dbRef, remove, set } from "firebase/database";
import { doc, getDoc } from "firebase/firestore";

export type Me = { uid: string; name: string; email: string };

// Tulisan Firestore di file ini lewat REST (writeNow), bukan setDoc/updateDoc SDK:
// lihat penjelasan di firestore-rest.ts.

// A menambahkan B sebagai kontak darurat → B akan memantau A (setelah B menerima)
export async function addUserByEmail(me: Me, rawEmail: string) {
  const email = rawEmail.trim().toLowerCase();
  if (!email.includes("@")) throw new Error("Format email tidak valid");
  if (email === me.email.toLowerCase())
    throw new Error("Tidak bisa menambahkan diri sendiri");

  const hit = await getDoc(doc(db, "emails", email));
  if (!hit.exists()) throw new Error("Email belum terdaftar di aplikasi");
  const target = hit.data() as { uid: string; name: string };

  const minePath = ["profile", me.uid, "emergency_contacts", target.uid];
  if ((await getDoc(doc(db, minePath.join("/")))).exists())
    throw new Error("Pengguna ini sudah ada di daftar");

  try {
    await writeNow(
      setWrite(minePath, {
        contactId: target.uid,
        name: target.name,
        phone: "",
        type: "registered",
        fcm_token: "",
        uid: target.uid,
        status: "pending",
      }),
    );
    await set(dbRef(rtdb, `access/${me.uid}/${target.uid}`), "pending");
    await writeNow(
      setWrite(["profile", target.uid, "monitoring", me.uid], {
        monitoringId: me.uid,
        target_uid: me.uid,
        target_name: me.name,
        status: "pending",
      }),
    );
  } catch (e) {
    await writeNow(deleteWrite(minePath)).catch(() => {});
    await remove(dbRef(rtdb, `access/${me.uid}/${target.uid}`)).catch(() => {});
    throw e;
  }
}

// B menerima/menolak permintaan dari A
export async function respondToInvite(
  myUid: string,
  ownerUid: string,
  accept: boolean,
) {
  const mon = ["profile", myUid, "monitoring", ownerUid];
  const theirContact = ["profile", ownerUid, "emergency_contacts", myUid];
  const access = dbRef(rtdb, `access/${ownerUid}/${myUid}`);
  if (accept) {
    await writeNow(updateWrite(mon, { status: "accepted" }));
    await writeNow(updateWrite(theirContact, { status: "accepted" }));
    await set(access, true);
  } else {
    await writeNow(updateWrite(theirContact, { status: "rejected" }));
    await remove(access);
    await writeNow(deleteWrite(mon));
  }
}

// A mencabut akses seseorang (pengguna terdaftar maupun guest)
export async function removeWatcher(myUid: string, c: Contact) {
  await writeNow(deleteWrite(["profile", myUid, "emergency_contacts", c.contactId]));
  if (c.type === "registered" && c.uid) {
    await remove(dbRef(rtdb, `access/${myUid}/${c.uid}`));
    await writeNow(deleteWrite(["profile", c.uid, "monitoring", myUid])).catch(() => {});
  }
}

// Link undangan guest: sekali pakai, berlaku 24 jam
export async function createInvitation(me: { uid: string; name: string }) {
  return createGuestInvitation(me.name);
}
